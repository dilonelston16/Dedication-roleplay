// config/discordStrategy.js
const DiscordStrategy = require('passport-discord').Strategy;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure the DB directory exists (important for Render)
const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Main database path
const dbPath = path.join(dbDir, 'database.sqlite');
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

// 🔧 (we'll re-add basic Discord-only logic here, without role sync complexity)
function initDiscordStrategy(passport) {
  const MAIN_OWNER_ID = '540674497968341024'; // your Discord ID

  passport.use(
    new DiscordStrategy(
      {
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: process.env.DISCORD_CALLBACK_URL,
        scope: ['identify']
      },
      (accessToken, refreshToken, profile, done) => {
        const discordId = profile.id;
        const username = `${profile.username}#${profile.discriminator}`;
        const avatar = profile.avatar;

        db.get(
          'SELECT * FROM users WHERE discord_id = ?',
          [discordId],
          (err, row) => {
            if (err) return done(err);

            if (!row) {
              // New user
              const initialRole =
                discordId === MAIN_OWNER_ID ? 'owner' : 'member';

              db.run(
                'INSERT INTO users (discord_id, discord_username, avatar, role) VALUES (?,?,?,?)',
                [discordId, username, avatar, initialRole],
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
              // Existing user: update username/avatar
              // And ensure your account is always owner
              const newRole =
                discordId === MAIN_OWNER_ID ? 'owner' : row.role;

              db.run(
                'UPDATE users SET discord_username = ?, avatar = ?, role = ? WHERE id = ?',
                [username, avatar, newRole, row.id],
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
