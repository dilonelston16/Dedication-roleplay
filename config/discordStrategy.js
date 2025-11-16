// config/discordStrategy.js
const DiscordStrategy = require('passport-discord').Strategy;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE,
      discord_username TEXT,
      avatar TEXT,
      role TEXT DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      department TEXT,
      about TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
});

// Helper: fetch member roles from Discord guild using the bot
async function fetchMemberRoles(discordId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!guildId || !botToken) {
    console.warn('DISCORD_GUILD_ID or DISCORD_BOT_TOKEN not set in .env');
    return [];
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
      {
        headers: {
          Authorization: `Bot ${botToken}`
        }
      }
    );

    if (!res.ok) {
      console.warn('Failed to fetch guild member from Discord API:', res.status);
      return [];
    }

    const data = await res.json();
    return Array.isArray(data.roles) ? data.roles : [];
  } catch (err) {
    console.error('Error fetching member roles from Discord:', err);
    return [];
  }
}

// Helper: map Discord role IDs to website role
function mapDiscordRolesToSiteRole(discordRoleIds) {
  const ownerId = process.env.ROLE_OWNER_ID;
  const adminId = process.env.ROLE_ADMIN_ID;
  const staffId = process.env.ROLE_STAFF_ID;
  const appsId = process.env.ROLE_APPLICATIONS_ID;

  // Highest priority first
  if (ownerId && discordRoleIds.includes(ownerId)) return 'owner';
  if (adminId && discordRoleIds.includes(adminId)) return 'admin';
  if (staffId && discordRoleIds.includes(staffId)) return 'staff';
  if (appsId && discordRoleIds.includes(appsId)) return 'applications';

  return 'member';
}

function initDiscordStrategy(passport) {
  passport.use(
    new DiscordStrategy(
      {
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: process.env.DISCORD_CALLBACK_URL,
        scope: ['identify'] // we use bot token + guild/member API for roles
      },
      (accessToken, refreshToken, profile, done) => {
        (async () => {
          const discordId = profile.id;
          const username = `${profile.username}#${profile.discriminator}`;
          const avatar = profile.avatar;

          // Get roles from Discord guild via bot
          const memberRoleIds = await fetchMemberRoles(discordId);
          const siteRole = mapDiscordRolesToSiteRole(memberRoleIds);

          db.get(
            'SELECT * FROM users WHERE discord_id = ?',
            [discordId],
            (err, row) => {
              if (err) return done(err);

              if (!row) {
                // New user
                db.run(
                  'INSERT INTO users (discord_id, discord_username, avatar, role) VALUES (?,?,?,?)',
                  [discordId, username, avatar, siteRole],
                  function (err2) {
                    if (err2) return done(err2);
                    db.get(
                      'SELECT * FROM users WHERE id = ?',
                      [this.lastID],
                      (err3, newUser) => {
                        if (err3) return done(err3);
                        return done(null, newUser);
                      }
                    );
                  }
                );
              } else {
                // Existing user: update username/avatar/role
                const finalRole = siteRole || row.role;
                db.run(
                  'UPDATE users SET discord_username = ?, avatar = ?, role = ? WHERE id = ?',
                  [username, avatar, finalRole, row.id],
                  function (err2) {
                    if (err2) return done(err2);
                    db.get(
                      'SELECT * FROM users WHERE id = ?',
                      [row.id],
                      (err3, updatedUser) => {
                        if (err3) return done(err3);
                        return done(null, updatedUser);
                      }
                    );
                  }
                );
              }
            }
          );
        })().catch(err => done(err));
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
      if (err) return done(err);
      done(null, row);
    });
  });
}

module.exports = {
  initDiscordStrategy,
  db
};
