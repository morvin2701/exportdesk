const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = q
      ? await req.db.query('SELECT TOP 12 * FROM dbo.customers WHERE name LIKE ? OR country LIKE ? ORDER BY updated_at DESC', [`%${q}%`, `%${q}%`])
      : await req.db.query('SELECT TOP 12 * FROM dbo.customers ORDER BY updated_at DESC');
    res.json({ items: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
