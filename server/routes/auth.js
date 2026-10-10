const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, setSessionCookie, clearSessionCookie, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured', code: 'DB_NOT_CONFIGURED' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const rows = await db.query('SELECT TOP 1 * FROM dbo.users WHERE email = ?', [String(email).trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  if (!user.active) return res.status(403).json({ error: 'This account has been disabled. Contact your admin.' });
  await db.query('UPDATE dbo.users SET last_login = SYSDATETIME() WHERE id = ?', [user.id]);
  await db.log(user.id, 'login', 'user', user.id);
  const token = signToken(user);
  setSessionCookie(res, token);
  res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put('/profile', requireAuth, async (req, res) => {
  const { name, currentPassword, newPassword } = req.body || {};
  if (name) await db.query('UPDATE dbo.users SET name = ?, updated_at = SYSDATETIME() WHERE id = ?', [String(name).trim(), req.user.id]);
  if (newPassword) {
    const rows = await db.query('SELECT password_hash FROM dbo.users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(String(currentPassword || ''), rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    await db.query('UPDATE dbo.users SET password_hash = ?, updated_at = SYSDATETIME() WHERE id = ?', [await bcrypt.hash(String(newPassword), 10), req.user.id]);
  }
  const rows = await db.query('SELECT id, name, email, role FROM dbo.users WHERE id = ?', [req.user.id]);
  res.json({ ok: true, user: rows[0] });
});

module.exports = router;
