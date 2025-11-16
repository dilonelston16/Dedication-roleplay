require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const SQLiteStore = require('connect-sqlite3')(session);
const { initDiscordStrategy, db } = require('./config/discordStrategy');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure DB directory exists for session store
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}


// Passport
initDiscordStrategy(passport);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: dbDir }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);


app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.discordInvite = 'https://discord.gg/CWGg4dEAEH';
  next();
});

// Middleware
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect('/login');
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    if (!roles.includes(req.user.role)) return res.status(403).render('unauthorized');
    next();
  };
}

// Routes
app.get('/', (req, res) => res.render('index'));

app.get('/login', passport.authenticate('discord'));

app.get(
  '/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => res.redirect('/dashboard')
);

app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/dashboard', ensureAuth, (req, res) => {
  res.render('dashboard', { user: req.user });
});

// Staff page
app.get('/staff', (req, res) => {
  db.all(
    "SELECT discord_username, role FROM users WHERE role != 'member' ORDER BY role DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).send('Database error');
      res.render('staff', { staff: rows });
    }
  );
});

// Application form
app.get('/apply', ensureAuth, (req, res) => {
  const departments = [
    'Los Santos Police Department',
    'Blaine County Sheriff\'s Office',
    'San Andreas State Police',
    'Fire & EMS',
    'Civilian Operations',
    'Communications'
  ];
  res.render('apply', { departments });
});

app.post('/apply', ensureAuth, (req, res) => {
  const { department, about } = req.body;
  db.run(
    'INSERT INTO applications (user_id, department, about, status) VALUES (?,?,?,?)',
    [req.user.id, department, about, 'pending'],
    err => {
      if (err) return res.status(500).send('Database error');
      res.redirect('/dashboard');
    }
  );
});

// View applications - owner/admin/staff/applications roles only
app.get('/applications', requireRole(['owner', 'admin', 'staff', 'applications']), (req, res) => {
  db.all(
    `SELECT a.id, a.department, a.about, a.status, a.created_at, u.discord_username
     FROM applications a
     JOIN users u ON a.user_id = u.id
     ORDER BY a.created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).send('Database error');
      res.render('applications', { applications: rows });
    }
  );
});

// Accept / reject applications - owner/admin/staff/applications
app.post('/applications/:id/accept', requireRole(['owner', 'admin', 'staff', 'applications']), (req, res) => {
  db.run('UPDATE applications SET status = ? WHERE id = ?', ['accepted', req.params.id], err => {
    if (err) return res.status(500).send('Database error');
    res.redirect('/applications');
  });
});

app.post('/applications/:id/reject', requireRole(['owner', 'admin', 'staff', 'applications']), (req, res) => {
  db.run('UPDATE applications SET status = ? WHERE id = ?', ['rejected', req.params.id], err => {
    if (err) return res.status(500).send('Database error');
    res.redirect('/applications');
  });
});

// Admin role manager - owner & admin
app.get('/admin/users', requireRole(['owner', 'admin']), (req, res) => {
  db.all('SELECT id, discord_username, role FROM users ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).send('Database error');
    res.render('admin_users', { users: rows });
  });
});

app.post('/admin/users/:id/role', requireRole(['owner', 'admin']), (req, res) => {
  db.run('UPDATE users SET role = ? WHERE id = ?', [req.body.role, req.params.id], err => {
    if (err) return res.status(500).send('Database error');
    res.redirect('/admin/users');
  });
});

// TEMP ROUTE: Make the current logged-in user the owner
app.get('/make-me-owner', ensureAuth, (req, res) => {
  const userId = req.user.id;
  db.run(
    'UPDATE users SET role = ? WHERE id = ?',
    ['owner', userId],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Database error');
      }
      res.send(
        'You are now set as OWNER. You can now access /admin/users. (You can remove this /make-me-owner route from app.js later for security.)'
      );
    }
  );
});

app.get('/unauthorized', (req, res) => res.status(403).render('unauthorized'));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
