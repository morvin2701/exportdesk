const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const rows = await req.db.query(`
      SELECT u.id, u.name, u.email, u.role, u.active, u.last_login, u.created_at,
        (SELECT COUNT(*) FROM dbo.invoices i WHERE i.created_by = u.id) AS invoice_count
      FROM dbo.users u ORDER BY u.created_at ASC`);
    const activity = await req.db.query(`
      SELECT TOP 25 a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, u.name AS user_name
      FROM dbo.activity_log a LEFT JOIN dbo.users u ON u.id = a.user_id ORDER BY a.created_at DESC`);
    res.json({ users: rows, activity });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const mail = String(email).trim().toLowerCase();
    const dup = await req.db.query('SELECT TOP 1 id FROM dbo.users WHERE email = ?', [mail]);
    if (dup.length) return res.status(409).json({ error: 'A user with this email already exists' });
    const id = await req.db.insert(
      'INSERT INTO dbo.users (name, email, password_hash, role, active) OUTPUT INSERTED.id VALUES (?, ?, ?, ?, 1)',
      [String(name).trim(), mail, await bcrypt.hash(String(password), 10), role === 'admin' ? 'admin' : 'staff']
    );
    await req.db.log(req.user.id, 'create', 'user', id, mail);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, email, role, active, password } = req.body || {};
    const rows = await req.db.query('SELECT * FROM dbo.users WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const newRole = role === 'admin' ? 'admin' : role === 'staff' ? 'staff' : rows[0].role;
    const newActive = active === undefined ? rows[0].active : (active ? 1 : 0);
    if (id === req.user.id && (newRole !== 'admin' || !newActive)) {
      return res.status(400).json({ error: 'You cannot remove your own admin access or disable yourself' });
    }
    if (rows[0].role === 'admin' && (newRole !== 'admin' || !newActive)) {
      const admins = await req.db.query("SELECT COUNT(*) AS c FROM dbo.users WHERE role = 'admin' AND active = 1 AND id <> ?", [id]);
      if (Number(admins[0].c) === 0) return res.status(400).json({ error: 'At least one active admin is required' });
    }
    const mail = email ? String(email).trim().toLowerCase() : rows[0].email;
    if (mail !== rows[0].email) {
      const dup = await req.db.query('SELECT TOP 1 id FROM dbo.users WHERE email = ? AND id <> ?', [mail, id]);
      if (dup.length) return res.status(409).json({ error: 'A user with this email already exists' });
    }
    await req.db.query('UPDATE dbo.users SET name = ?, email = ?, role = ?, active = ?, updated_at = SYSDATETIME() WHERE id = ?',
      [name ? String(name).trim() : rows[0].name, mail, newRole, newActive, id]);
    if (password) {
      if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      await req.db.query('UPDATE dbo.users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(String(password), 10), id]);
    }
    await req.db.log(req.user.id, 'update', 'user', id, mail);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const rows = await req.db.query('SELECT role, email FROM dbo.users WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (rows[0].role === 'admin') {
      const admins = await req.db.query("SELECT COUNT(*) AS c FROM dbo.users WHERE role = 'admin' AND active = 1 AND id <> ?", [id]);
      if (Number(admins[0].c) === 0) return res.status(400).json({ error: 'At least one active admin is required' });
    }
    await req.db.query('UPDATE dbo.invoices SET created_by = NULL WHERE created_by = ?', [id]);
    await req.db.query('DELETE FROM dbo.users WHERE id = ?', [id]);
    await req.db.log(req.user.id, 'delete', 'user', id, rows[0].email);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
