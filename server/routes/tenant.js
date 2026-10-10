/** Client self-activation (multi mode): company code + activation key → connect their SQL Server → create their admin. */
const express = require('express');
const db = require('../db');
const { userToken, setSessionCookie } = require('../auth');
const { createFirstAdmin, userCount } = require('./setup');

const router = express.Router();
router.use((req, res, next) => { if (!db.isMulti()) return res.status(400).json({ error: 'Not available in single-client mode' }); next(); });

async function tenantFor(req, res, needKey = true) {
  const { code, key } = req.body || {};
  if (!code) { res.status(400).json({ error: 'Company code is required' }); return null; }
  let row;
  try { row = await db.getTenantByCode(code); } catch (e) { res.status(503).json({ error: 'Registry database not reachable: ' + db.friendlyError(e) }); return null; }
  if (!row) { res.status(404).json({ error: 'Unknown company code' }); return null; }
  if (!row.active) { res.status(403).json({ error: 'This company account is disabled. Please contact support.' }); return null; }
  if (needKey && (!key || String(key).trim().toUpperCase() !== String(row.activation_key || '').toUpperCase())) { res.status(401).json({ error: 'Invalid activation key' }); return null; }
  return row;
}

router.post('/lookup', async (req, res) => {
  const row = await tenantFor(req, res, false);
  if (!row) return;
  let hasUsers = false;
  if (row.db_server && row.db_ready) { try { hasUsers = (await userCount(db.tenantHandle(row))) > 0; } catch (e) { /* unreachable */ } }
  res.json({ code: row.code, name: row.name, dbConfigured: !!row.db_server, dbReady: !!row.db_ready, hasUsers });
});

function inputFrom(row, body) {
  const stored = db.tenantConfig(row);
  const b = body || {};
  return {
    server: b.server !== undefined ? String(b.server || '').trim() : stored.server,
    port: b.port !== undefined ? (Number(b.port) || null) : stored.port,
    authType: b.authType !== undefined ? (b.authType === 'windows' ? 'windows' : 'sql') : stored.authType,
    domain: b.domain !== undefined ? String(b.domain || '') : stored.domain,
    user: b.user !== undefined ? String(b.user || '').trim() : stored.user,
    password: b.password ? String(b.password) : stored.password,
    encrypt: b.encrypt !== undefined ? b.encrypt !== false : stored.encrypt,
    database: b.database ? db.sanitizeIdentifier(b.database) : (stored.database || `ExportDesk_${row.code}`),
  };
}

router.post('/activate/test', async (req, res) => {
  const row = await tenantFor(req, res); if (!row) return;
  const input = inputFrom(row, req.body);
  if (!input.server || !input.user) return res.status(400).json({ error: 'SQL Server address and login are required' });
  try { res.json({ ok: true, ...(await db.testConnection(input)) }); }
  catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});

router.post('/activate/install', async (req, res) => {
  const row = await tenantFor(req, res); if (!row) return;
  const input = inputFrom(row, req.body);
  if (!input.server || !input.user) return res.status(400).json({ error: 'SQL Server address and login are required' });
  try {
    const out = await db.installSchema(input);
    await db.registry().query(
      `UPDATE dbo.exportdesklink SET db_server = ?, db_port = ?, db_auth = ?, db_domain = ?, db_user = ?, db_password = ?, db_database = ?, db_encrypt = ?, db_ready = 1, last_checked = SYSDATETIME(), last_status = 'OK · activated by client', updated_at = SYSDATETIME() WHERE id = ?`,
      [input.server, input.port, input.authType, input.domain || null, input.user, db.encrypt(input.password), out.database, out.encrypt ? 1 : 0, row.id]);
    db.invalidateTenant(row.id);
    res.json({ ok: true, ...out });
  } catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});

router.post('/activate/admin', async (req, res) => {
  const row = await tenantFor(req, res); if (!row) return;
  const fresh = await db.getTenantById(row.id);
  if (!fresh.db_server) return res.status(400).json({ error: 'Connect your SQL Server first' });
  try {
    const handle = db.tenantHandle(fresh);
    if ((await userCount(handle)) > 0) return res.status(400).json({ error: 'An admin already exists for this company. Please sign in.' });
    const user = await createFirstAdmin(handle, { ...req.body, company: (req.body && req.body.company) || fresh.name });
    const token = userToken(user, fresh.id);
    setSessionCookie(res, token);
    res.json({ ok: true, token, user, tenant: { code: fresh.code, name: fresh.name } });
  } catch (e) { res.status(400).json({ error: db.friendlyError(e) }); }
});

module.exports = router;
