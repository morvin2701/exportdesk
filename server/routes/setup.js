const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { userToken, setSessionCookie, platformEnabled } = require('../auth');

const router = express.Router();

async function userCount(handle) {
  try { const rows = await handle.query('SELECT COUNT(*) AS c FROM dbo.users'); return Number(rows[0].c); } catch (e) { return 0; }
}

/** App bootstrap status — drives the wizard / login / shell on the frontend. */
router.get('/status', async (req, res) => {
  if (db.isMulti()) {
    let connected = false;
    try { connected = await db.registry().ping(); } catch (e) { /* not reachable */ }
    return res.json({
      mode: 'multi', configured: true, connected, hasUsers: true,
      platformEnabled: platformEnabled(), platform: req.platformAdmin,
      tenant: req.tenant ? { id: req.tenant.id, code: req.tenant.code, name: req.tenant.name, db_server: req.tenant.db_server, db_database: req.tenant.db_database } : null,
      user: req.user || null,
    });
  }
  const configured = db.isConfigured();
  let connected = false, users = 0;
  if (configured) { connected = await db.local().ping(); if (connected) users = await userCount(db.local()); }
  res.json({ mode: 'single', configured, connected, hasUsers: users > 0, db: db.publicConfig(), user: req.user || null, platform: null, platformEnabled: false });
});

function singleOnly(req, res, next) {
  if (db.isMulti()) return res.status(400).json({ error: 'This server runs in multi-client mode. Clients are managed from the Clients page.' });
  next();
}

router.post('/test', singleOnly, async (req, res) => {
  const input = req.body || {};
  if (!input.server) return res.status(400).json({ error: 'Server / instance name is required (e.g. DESKTOP-PC\\SQLEXPRESS)' });
  if (!input.user) return res.status(400).json({ error: 'Username is required' });
  try { res.json({ ok: true, ...(await db.testConnection(input)) }); }
  catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});

router.post('/install', singleOnly, async (req, res) => {
  if (db.isConfigured() && (await db.local().ping()) && (await userCount(db.local())) > 0) {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can change the database connection' });
  }
  const input = req.body || {};
  if (!input.server) return res.status(400).json({ error: 'Server / instance name is required' });
  if (!input.user) return res.status(400).json({ error: 'Username is required' });
  if (!input.database) return res.status(400).json({ error: 'Database name is required' });
  try { res.json({ ok: true, ...(await db.install(input)) }); }
  catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});

/** Create the very first admin account (single mode). */
router.post('/admin', singleOnly, async (req, res) => {
  const handle = db.local();
  if (!handle) return res.status(503).json({ error: 'Database not configured', code: 'DB_NOT_CONFIGURED' });
  if ((await userCount(handle)) > 0) return res.status(400).json({ error: 'An admin account already exists. Please sign in.' });
  try {
    const user = await createFirstAdmin(handle, req.body || {});
    const token = userToken(user, null);
    setSessionCookie(res, token);
    res.json({ ok: true, token, user });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/** Shared by single-mode wizard, platform "create client admin" and client self-activation. */
async function createFirstAdmin(handle, { name, email, password, company }) {
  if (!name || !email || !password) throw new Error('Name, email and password are required');
  if (String(password).length < 6) throw new Error('Password must be at least 6 characters');
  const hash = await bcrypt.hash(String(password), 10);
  const id = await handle.insert("INSERT INTO dbo.users (name, email, password_hash, role, active) OUTPUT INSERTED.id VALUES (?, ?, ?, 'admin', 1)",
    [String(name).trim(), String(email).trim().toLowerCase(), hash]);
  if (company) { const existing = (await handle.getSetting('company')) || {}; await handle.setSetting('company', { ...existing, name: String(company).trim() }); }
  await handle.log(id, 'setup', 'user', id, 'Initial admin created');
  return { id, name: String(name).trim(), email: String(email).trim().toLowerCase(), role: 'admin' };
}

module.exports = router;
module.exports.createFirstAdmin = createFirstAdmin;
module.exports.userCount = userCount;
