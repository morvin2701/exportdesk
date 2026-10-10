const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { userToken, setSessionCookie, clearSessionCookie, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password, code } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  let handle = null, tenant = null;
  if (db.isMulti()) {
    if (!code) return res.status(400).json({ error: 'Company code is required' });
    try { tenant = await db.getTenantByCode(code); } catch (e) { return res.status(503).json({ error: 'Registry database not reachable: ' + db.friendlyError(e) }); }
    if (!tenant) return res.status(404).json({ error: 'Unknown company code' });
    if (!tenant.active) return res.status(403).json({ error: 'This company account is disabled. Please contact support.' });
    if (!tenant.db_server) return res.status(400).json({ error: 'This company has not completed setup yet. Use "Set up your company" with your activation key.', code: 'TENANT_NOT_SETUP' });
    handle = db.tenantHandle(tenant);
  } else {
    handle = db.local();
    if (!handle) return res.status(503).json({ error: 'Database not configured', code: 'DB_NOT_CONFIGURED' });
  }
  let rows;
  try { rows = await handle.query('SELECT TOP 1 * FROM dbo.users WHERE email = ?', [String(email).trim().toLowerCase()]); }
  catch (e) { return res.status(503).json({ error: "Your company's SQL Server is not reachable right now: " + db.friendlyError(e), code: 'TENANT_DB_DOWN' }); }
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) return res.status(401).json({ error: 'Incorrect email or password' });
  if (!user.active) return res.status(403).json({ error: 'This account has been disabled. Contact your admin.' });
  await handle.query('UPDATE dbo.users SET last_login = SYSDATETIME() WHERE id = ?', [user.id]);
  await handle.log(user.id, 'login', 'user', user.id);
  const token = userToken(user, tenant ? tenant.id : null);
  setSessionCookie(res, token);
  res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, tenant: tenant ? { code: tenant.code, name: tenant.name } : null });
});

router.post('/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.put('/profile', requireAuth, async (req, res) => {
  const { name, currentPassword, newPassword } = req.body || {};
  if (name) await req.db.query('UPDATE dbo.users SET name = ?, updated_at = SYSDATETIME() WHERE id = ?', [String(name).trim(), req.user.id]);
  if (newPassword) {
    const rows = await req.db.query('SELECT password_hash FROM dbo.users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(String(currentPassword || ''), rows[0].password_hash))) return res.status(400).json({ error: 'Current password is incorrect' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    await req.db.query('UPDATE dbo.users SET password_hash = ?, updated_at = SYSDATETIME() WHERE id = ?', [await bcrypt.hash(String(newPassword), 10), req.user.id]);
  }
  const rows = await req.db.query('SELECT id, name, email, role FROM dbo.users WHERE id = ?', [req.user.id]);
  res.json({ ok: true, user: rows[0] });
});

module.exports = router;
