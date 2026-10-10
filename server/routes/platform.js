/** Platform owner API (multi mode): manage clients in the `exportdesklink` registry. */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { platformToken, setSessionCookie, requirePlatform, verifyPlatform, platformEnabled } = require('../auth');
const { createFirstAdmin, userCount } = require('./setup');

const router = express.Router();

function multiOnly(req, res, next) {
  if (!db.isMulti()) return res.status(400).json({ error: 'Multi-client mode is not enabled on this server (REGISTRY_SERVER not set).' });
  next();
}
router.use(multiOnly);

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!platformEnabled()) return res.status(400).json({ error: 'Platform owner login is not configured (PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD).' });
  if (!(await verifyPlatform(email, password))) return res.status(401).json({ error: 'Incorrect email or password' });
  const token = platformToken(String(email).trim().toLowerCase());
  setSessionCookie(res, token);
  res.json({ ok: true, token, platform: { email: String(email).trim().toLowerCase() } });
});

router.use(requirePlatform);

function newKey() { return crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'); }
function normCode(c) { return String(c || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40); }

router.get('/clients', async (req, res) => {
  try {
    const rows = await db.registry().query('SELECT * FROM dbo.exportdesklink ORDER BY created_at DESC');
    res.json({ items: rows.map(db.publicTenant) });
  } catch (e) { res.status(500).json({ error: db.friendlyError(e) }); }
});

function dbFieldsFrom(body, existing = {}) {
  const out = {
    db_server: body.db_server !== undefined ? String(body.db_server || '').trim() : existing.db_server || null,
    db_port: body.db_port !== undefined ? (Number(body.db_port) || null) : existing.db_port || null,
    db_auth: body.db_auth !== undefined ? (body.db_auth === 'windows' ? 'windows' : 'sql') : existing.db_auth || 'sql',
    db_domain: body.db_domain !== undefined ? String(body.db_domain || '').trim() : existing.db_domain || null,
    db_user: body.db_user !== undefined ? String(body.db_user || '').trim() : existing.db_user || null,
    db_password: body.db_password ? db.encrypt(String(body.db_password)) : existing.db_password || null,
    db_database: body.db_database !== undefined ? db.sanitizeIdentifier(body.db_database) : existing.db_database || null,
    db_encrypt: body.db_encrypt !== undefined ? (body.db_encrypt ? 1 : 0) : (existing.db_encrypt === undefined ? 1 : (existing.db_encrypt ? 1 : 0)),
  };
  return out;
}

router.post('/clients', async (req, res) => {
  try {
    const b = req.body || {};
    const code = normCode(b.code);
    if (!b.name || !code) return res.status(400).json({ error: 'Company name and code are required' });
    const dup = await db.registry().query('SELECT TOP 1 id FROM dbo.exportdesklink WHERE code = ?', [code]);
    if (dup.length) return res.status(409).json({ error: `Code ${code} is already used` });
    const f = dbFieldsFrom(b);
    if (!f.db_database) f.db_database = `ExportDesk_${code.replace(/[^A-Z0-9_]/g, '_')}`;
    const id = await db.registry().insert(
      `INSERT INTO dbo.exportdesklink (code, name, contact_name, contact_email, contact_phone, db_server, db_port, db_auth, db_domain, db_user, db_password, db_database, db_encrypt, db_ready, activation_key, active, notes)
       OUTPUT INSERTED.id VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?)`,
      [code, String(b.name).trim(), b.contact_name || null, b.contact_email || null, b.contact_phone || null, f.db_server || null, f.db_port, f.db_auth, f.db_domain || null, f.db_user || null, f.db_password, f.db_database, f.db_encrypt, newKey(), b.notes || null]);
    res.json({ ok: true, id, code });
  } catch (e) { res.status(500).json({ error: db.friendlyError(e) }); }
});

router.put('/clients/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await db.getTenantById(id);
    if (!row) return res.status(404).json({ error: 'Client not found' });
    const b = req.body || {};
    const f = dbFieldsFrom(b, row);
    const code = b.code !== undefined ? normCode(b.code) : row.code;
    if (!code) return res.status(400).json({ error: 'Code is required' });
    if (code !== row.code) {
      const dup = await db.registry().query('SELECT TOP 1 id FROM dbo.exportdesklink WHERE code = ? AND id <> ?', [code, id]);
      if (dup.length) return res.status(409).json({ error: `Code ${code} is already used` });
    }
    const dbChanged = ['db_server', 'db_port', 'db_auth', 'db_domain', 'db_user', 'db_password', 'db_database'].some(k => (f[k] || null) !== (row[k] || null));
    await db.registry().query(
      `UPDATE dbo.exportdesklink SET code = ?, name = ?, contact_name = ?, contact_email = ?, contact_phone = ?, db_server = ?, db_port = ?, db_auth = ?, db_domain = ?, db_user = ?, db_password = ?, db_database = ?, db_encrypt = ?, active = ?, notes = ?, db_ready = ?, updated_at = SYSDATETIME() WHERE id = ?`,
      [code, b.name !== undefined ? String(b.name).trim() : row.name, b.contact_name !== undefined ? b.contact_name : row.contact_name, b.contact_email !== undefined ? b.contact_email : row.contact_email, b.contact_phone !== undefined ? b.contact_phone : row.contact_phone,
        f.db_server || null, f.db_port, f.db_auth, f.db_domain || null, f.db_user || null, f.db_password, f.db_database || null, f.db_encrypt,
        b.active !== undefined ? (b.active ? 1 : 0) : (row.active ? 1 : 0), b.notes !== undefined ? b.notes : row.notes, dbChanged ? 0 : (row.db_ready ? 1 : 0), id]);
    db.invalidateTenant(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: db.friendlyError(e) }); }
});

router.delete('/clients/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.registry().query('DELETE FROM dbo.exportdesklink WHERE id = ?', [id]);
    db.invalidateTenant(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: db.friendlyError(e) }); }
});

router.post('/clients/:id/key', async (req, res) => {
  try {
    const key = newKey();
    await db.registry().query('UPDATE dbo.exportdesklink SET activation_key = ?, updated_at = SYSDATETIME() WHERE id = ?', [key, Number(req.params.id)]);
    res.json({ ok: true, activation_key: key });
  } catch (e) { res.status(500).json({ error: db.friendlyError(e) }); }
});

async function recordStatus(id, text) {
  try { await db.registry().query('UPDATE dbo.exportdesklink SET last_checked = SYSDATETIME(), last_status = ? WHERE id = ?', [String(text).slice(0, 500), id]); } catch (e) { /* ignore */ }
}

/** Test the client's SQL Server (stored credentials, optionally overridden by the body). */
router.post('/clients/:id/test', async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.getTenantById(id);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  const cfg = { ...db.tenantConfig(row), ...pickOverrides(req.body) };
  if (!cfg.server || !cfg.user) return res.status(400).json({ error: 'SQL Server address and login are required' });
  try {
    const info = await db.testConnection(cfg);
    let dbExists = info.databases.includes(cfg.database), users = 0;
    if (dbExists) { try { users = await userCount(db.createHandle(cfg)); } catch (e) { /* ignore */ } }
    await recordStatus(id, `OK · SQL Server ${info.version}`);
    res.json({ ok: true, ...info, database: cfg.database, dbExists, hasUsers: users > 0 });
  } catch (e) {
    const msg = db.friendlyError(e);
    await recordStatus(id, 'ERROR · ' + msg);
    res.status(400).json({ error: msg });
  }
});

/** Create the client's database + tables on their SQL Server. */
router.post('/clients/:id/install', async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.getTenantById(id);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  const cfg = { ...db.tenantConfig(row), ...pickOverrides(req.body) };
  if (!cfg.server || !cfg.user) return res.status(400).json({ error: 'SQL Server address and login are required' });
  try {
    const out = await db.installSchema(cfg);
    await db.registry().query('UPDATE dbo.exportdesklink SET db_ready = 1, db_encrypt = ?, db_database = ?, updated_at = SYSDATETIME() WHERE id = ?', [out.encrypt ? 1 : 0, out.database, id]);
    await recordStatus(id, 'OK · database ready');
    db.invalidateTenant(id);
    res.json({ ok: true, ...out });
  } catch (e) {
    const msg = db.friendlyError(e);
    await recordStatus(id, 'ERROR · ' + msg);
    res.status(400).json({ error: msg });
  }
});

/** Create the client's first admin user inside their database. */
router.post('/clients/:id/admin', async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.getTenantById(id);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  if (!row.db_server) return res.status(400).json({ error: 'Set the SQL Server connection first' });
  try {
    const handle = db.tenantHandle(row);
    if ((await userCount(handle)) > 0) return res.status(400).json({ error: 'This client already has users. They can sign in or reset passwords from their Team page.' });
    const user = await createFirstAdmin(handle, { ...req.body, company: (req.body && req.body.company) || row.name });
    res.json({ ok: true, user });
  } catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});

/** Users of a client (for support: see who exists, reset a password). */
router.get('/clients/:id/users', async (req, res) => {
  const row = await db.getTenantById(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Client not found' });
  try { res.json({ items: await db.tenantHandle(row).query('SELECT id, name, email, role, active, last_login, created_at FROM dbo.users ORDER BY created_at') }); }
  catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});
router.post('/clients/:id/users/:uid/reset', async (req, res) => {
  const row = await db.getTenantById(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Client not found' });
  const pw = String((req.body && req.body.password) || '');
  if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const bcrypt = require('bcryptjs');
    await db.tenantHandle(row).query('UPDATE dbo.users SET password_hash = ?, active = 1, updated_at = SYSDATETIME() WHERE id = ?', [await bcrypt.hash(pw, 10), Number(req.params.uid)]);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});

function pickOverrides(body) {
  const b = body || {}; const out = {};
  if (b.db_server) out.server = String(b.db_server).trim();
  if (b.db_port !== undefined) out.port = Number(b.db_port) || null;
  if (b.db_auth) out.authType = b.db_auth === 'windows' ? 'windows' : 'sql';
  if (b.db_domain !== undefined) out.domain = String(b.db_domain || '');
  if (b.db_user) out.user = String(b.db_user).trim();
  if (b.db_password) out.password = String(b.db_password);
  if (b.db_database) out.database = db.sanitizeIdentifier(b.db_database);
  if (b.db_encrypt !== undefined) out.encrypt = !!b.db_encrypt;
  return out;
}

module.exports = router;
