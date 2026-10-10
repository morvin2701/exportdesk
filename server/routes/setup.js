const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, setSessionCookie } = require('../auth');

const router = express.Router();

async function userCount() {
  try {
    const rows = await db.query('SELECT COUNT(*) AS c FROM dbo.users');
    return Number(rows[0].c);
  } catch (e) {
    return 0;
  }
}

/** App bootstrap status — drives the first-run wizard on the frontend. */
router.get('/status', async (req, res) => {
  const configured = db.isConfigured();
  let connected = false;
  let users = 0;
  if (configured) {
    connected = await db.ping();
    if (connected) users = await userCount();
  }
  res.json({
    configured,
    connected,
    hasUsers: users > 0,
    db: db.publicConfig(),
    user: req.user || null,
  });
});

/** Test the SQL Server instance credentials (connects to master). */
router.post('/test', async (req, res) => {
  const input = req.body || {};
  if (!input.server) return res.status(400).json({ error: 'Server / instance name is required (e.g. DESKTOP-PC\\SQLEXPRESS)' });
  if (!input.user) return res.status(400).json({ error: 'Username is required' });
  try {
    const info = await db.testConnection(input);
    res.json({ ok: true, ...info });
  } catch (e) {
    res.status(400).json({ error: db.friendlyError(e) });
  }
});

/** Create the database + tables and save the instance config on this PC. */
router.post('/install', async (req, res) => {
  if (db.isConfigured() && (await db.ping()) && (await userCount()) > 0) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can change the database connection' });
    }
  }
  const input = req.body || {};
  if (!input.server) return res.status(400).json({ error: 'Server / instance name is required' });
  if (!input.user) return res.status(400).json({ error: 'Username is required' });
  if (!input.database) return res.status(400).json({ error: 'Database name is required' });
  try {
    const out = await db.install(input);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ error: db.friendlyError(e) });
  }
});

/** Create the very first admin account. Only works while the users table is empty. */
router.post('/admin', async (req, res) => {
  if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured', code: 'DB_NOT_CONFIGURED' });
  if ((await userCount()) > 0) return res.status(400).json({ error: 'An admin account already exists. Please sign in.' });
  const { name, email, password, company } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const hash = await bcrypt.hash(String(password), 10);
  const id = await db.insert(
    "INSERT INTO dbo.users (name, email, password_hash, role, active) OUTPUT INSERTED.id VALUES (?, ?, ?, 'admin', 1)",
    [String(name).trim(), String(email).trim().toLowerCase(), hash]
  );
  if (company) {
    const existing = (await db.getSetting('company')) || {};
    await db.setSetting('company', { ...existing, name: String(company).trim() });
  }
  const user = { id, name, email, role: 'admin' };
  await db.log(id, 'setup', 'user', id, 'Initial admin created');
  const token = signToken(user);
  setSessionCookie(res, token);
  res.json({ ok: true, token, user });
});

module.exports = router;
