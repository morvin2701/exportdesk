const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const DEFAULTS = require('../defaults');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['draft', 'unpaid', 'partial', 'paid', 'cancelled'];

function pad(n, width) { return String(n).padStart(width, '0'); }

/** Build the next invoice number from numbering settings, e.g. EXP-INV-2026-0001 */
async function nextNumber(peekOnly, dateStr) {
  const numbering = { ...DEFAULTS.numbering, ...((await db.getSetting('numbering')) || {}) };
  const prefix = String(numbering.prefix || 'INV').trim();
  const width = Number(numbering.padding) || 4;
  const d = dateStr ? new Date(dateStr) : new Date();
  const year = isNaN(d) ? new Date().getFullYear() : d.getFullYear();
  const yearPart = numbering.yearInNumber === false ? '' : `-${year}`;
  const key = numbering.yearInNumber === false ? 'invoice' : `invoice-${year}`;

  const rows = await db.query('SELECT last_no FROM dbo.sequences WHERE seq_key = ?', [key]);
  let last = rows.length ? Number(rows[0].last_no) : 0;
  const start = Number(numbering.startFrom) || 1;
  let next = Math.max(last + 1, start);

  // Skip any numbers that already exist (e.g. custom numbers typed manually)
  for (let guard = 0; guard < 500; guard++) {
    const candidate = `${prefix}${yearPart}-${pad(next, width)}`;
    const exists = await db.query('SELECT TOP 1 id FROM dbo.invoices WHERE number = ?', [candidate]);
    if (!exists.length) break;
    next++;
  }
  const number = `${prefix}${yearPart}-${pad(next, width)}`;
  if (!peekOnly) {
    await db.query(
      `MERGE dbo.sequences AS t USING (SELECT ? AS k, ? AS n) AS s ON t.seq_key = s.k
       WHEN MATCHED THEN UPDATE SET last_no = s.n
       WHEN NOT MATCHED THEN INSERT (seq_key, last_no) VALUES (s.k, s.n);`,
      [key, next]
    );
  }
  return number;
}

/** After saving a numbered invoice, move the sequence forward so the next auto number is instant. */
async function bumpSequence(number, dateStr) {
  try {
    const numbering = { ...DEFAULTS.numbering, ...((await db.getSetting('numbering')) || {}) };
    const prefix = String(numbering.prefix || 'INV').trim();
    const d = dateStr ? new Date(dateStr) : new Date();
    const year = isNaN(d) ? new Date().getFullYear() : d.getFullYear();
    const yearPart = numbering.yearInNumber === false ? '' : `-${year}`;
    const key = numbering.yearInNumber === false ? 'invoice' : `invoice-${year}`;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = String(number).match(new RegExp(`^${esc(prefix + yearPart)}-(\\d+)$`));
    if (!m) return;
    const n = Number(m[1]);
    await db.query(
      `MERGE dbo.sequences AS t USING (SELECT ? AS k, ? AS n) AS s ON t.seq_key = s.k
       WHEN MATCHED AND s.n > t.last_no THEN UPDATE SET last_no = s.n
       WHEN NOT MATCHED THEN INSERT (seq_key, last_no) VALUES (s.k, s.n);`,
      [key, n]
    );
  } catch (e) { /* non-critical */ }
}

router.get('/next-number', async (req, res) => {
  try {
    res.json({ number: await nextNumber(true, req.query.date) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN status IN ('unpaid','partial') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_count,
        SUM(CASE WHEN MONTH(issue_date) = MONTH(GETDATE()) AND YEAR(issue_date) = YEAR(GETDATE()) AND status <> 'cancelled' THEN 1 ELSE 0 END) AS month_count
      FROM dbo.invoices`);
    const byCurrency = await db.query(`
      SELECT currency,
        SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END) AS billed,
        SUM(CASE WHEN status IN ('unpaid','partial') THEN total - amount_paid ELSE 0 END) AS outstanding,
        SUM(CASE WHEN status = 'paid' THEN total WHEN status = 'partial' THEN amount_paid ELSE 0 END) AS collected
      FROM dbo.invoices GROUP BY currency ORDER BY billed DESC`);
    const recent = await db.query(`
      SELECT TOP 6 i.id, i.number, i.status, i.issue_date, i.currency, i.total, i.customer_name, i.customer_country, u.name AS created_by_name
      FROM dbo.invoices i LEFT JOIN dbo.users u ON u.id = i.created_by ORDER BY i.updated_at DESC`);
    res.json({ summary: rows[0], byCurrency, recent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/', async (req, res) => {
  try {
    const { q = '', status = '', from = '', to = '', page = 1, limit = 20, sort = 'updated_at', dir = 'desc' } = req.query;
    const where = [];
    const params = [];
    if (q) { where.push('(i.number LIKE ? OR i.customer_name LIKE ? OR i.customer_country LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (status && STATUSES.includes(status)) { where.push('i.status = ?'); params.push(status); }
    if (from) { where.push('i.issue_date >= ?'); params.push(from); }
    if (to) { where.push('i.issue_date <= ?'); params.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortCol = ['updated_at', 'issue_date', 'number', 'total', 'customer_name', 'status'].includes(sort) ? sort : 'updated_at';
    const sortDir = dir === 'asc' ? 'ASC' : 'DESC';
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * lim;

    const countRows = await db.query(`SELECT COUNT(*) AS c FROM dbo.invoices i ${whereSql}`, params);
    const rows = await db.query(
      `SELECT i.id, i.number, i.status, i.issue_date, i.due_date, i.currency, i.customer_name, i.customer_country,
              i.subtotal, i.total, i.amount_paid, i.created_at, i.updated_at, u.name AS created_by_name
       FROM dbo.invoices i LEFT JOIN dbo.users u ON u.id = i.created_by
       ${whereSql} ORDER BY i.${sortCol} ${sortDir} OFFSET ${offset} ROWS FETCH NEXT ${lim} ROWS ONLY`,
      params
    );
    res.json({ items: rows, total: Number(countRows[0].c), page: Number(page) || 1, limit: lim });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT i.*, u.name AS created_by_name FROM dbo.invoices i LEFT JOIN dbo.users u ON u.id = i.created_by WHERE i.id = ?`,
      [Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    const row = rows[0];
    let data = {};
    try { data = JSON.parse(row.data); } catch (e) { /* ignore */ }
    res.json({ ...row, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function normalizeInvoice(body) {
  const data = body && body.data ? body.data : {};
  const number = String(body.number || data.number || '').trim();
  const status = STATUSES.includes(body.status) ? body.status : 'unpaid';
  const issueDate = (data.date || body.issue_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dueDate = data.dueDate ? String(data.dueDate).slice(0, 10) : null;
  const currency = String(data.currency || 'USD').toUpperCase().slice(0, 8);
  const customerName = String((data.consignee && data.consignee.name) || 'Customer').trim().slice(0, 190);
  const customerCountry = String((data.consignee && data.consignee.country) || '').trim().slice(0, 120);
  const totals = data.totals || {};
  const subtotal = Number(totals.subtotal) || 0;
  const total = Number(totals.grandTotal) || 0;
  let amountPaid = Number(body.amount_paid != null ? body.amount_paid : data.amountPaid) || 0;
  if (status === 'paid') amountPaid = total;
  if (status === 'unpaid' || status === 'draft') amountPaid = 0;
  return { number, status, issueDate, dueDate, currency, customerName, customerCountry, subtotal, total, amountPaid, data: { ...data, number, status, amountPaid } };
}

async function upsertCustomer(c) {
  if (!c || !c.name) return;
  const name = String(c.name).trim().slice(0, 190);
  if (!name) return;
  await db.query(
    `MERGE dbo.customers AS t USING (SELECT ? AS name) AS s ON t.name = s.name
     WHEN MATCHED THEN UPDATE SET contact = ?, address = ?, city = ?, country = ?, phone = ?, email = ?, tax_id = ?, updated_at = SYSDATETIME()
     WHEN NOT MATCHED THEN INSERT (name, contact, address, city, country, phone, email, tax_id) VALUES (s.name, ?, ?, ?, ?, ?, ?, ?);`,
    [name,
      c.contact || null, c.address || null, c.city || null, c.country || null, c.phone || null, c.email || null, c.taxId || null,
      c.contact || null, c.address || null, c.city || null, c.country || null, c.phone || null, c.email || null, c.taxId || null]
  );
}

router.post('/', async (req, res) => {
  try {
    const inv = normalizeInvoice(req.body);
    if (!inv.number) inv.number = await nextNumber(false, inv.issueDate);
    inv.data.number = inv.number;
    const dup = await db.query('SELECT TOP 1 id FROM dbo.invoices WHERE number = ?', [inv.number]);
    if (dup.length) return res.status(409).json({ error: `Invoice number ${inv.number} already exists` });
    const id = await db.insert(
      `INSERT INTO dbo.invoices (number, status, issue_date, due_date, currency, customer_name, customer_country, subtotal, total, amount_paid, data, created_by, updated_by)
       OUTPUT INSERTED.id VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [inv.number, inv.status, inv.issueDate, inv.dueDate, inv.currency, inv.customerName, inv.customerCountry, inv.subtotal, inv.total, inv.amountPaid, JSON.stringify(inv.data), req.user.id, req.user.id]
    );
    await upsertCustomer(inv.data.consignee);
    await bumpSequence(inv.number, inv.issueDate);
    await db.log(req.user.id, 'create', 'invoice', id, inv.number);
    res.json({ ok: true, id, number: inv.number });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.query('SELECT id, number FROM dbo.invoices WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = normalizeInvoice(req.body);
    if (!inv.number) inv.number = existing[0].number;
    inv.data.number = inv.number;
    const dup = await db.query('SELECT TOP 1 id FROM dbo.invoices WHERE number = ? AND id <> ?', [inv.number, id]);
    if (dup.length) return res.status(409).json({ error: `Invoice number ${inv.number} is used by another invoice` });
    await db.query(
      `UPDATE dbo.invoices SET number = ?, status = ?, issue_date = ?, due_date = ?, currency = ?, customer_name = ?, customer_country = ?,
        subtotal = ?, total = ?, amount_paid = ?, data = ?, updated_by = ?, updated_at = SYSDATETIME() WHERE id = ?`,
      [inv.number, inv.status, inv.issueDate, inv.dueDate, inv.currency, inv.customerName, inv.customerCountry, inv.subtotal, inv.total, inv.amountPaid, JSON.stringify(inv.data), req.user.id, id]
    );
    await upsertCustomer(inv.data.consignee);
    await bumpSequence(inv.number, inv.issueDate);
    await db.log(req.user.id, 'update', 'invoice', id, inv.number);
    res.json({ ok: true, id, number: inv.number });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, amount_paid } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const rows = await db.query('SELECT total, data FROM dbo.invoices WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    let paid = Number(amount_paid) || 0;
    if (status === 'paid') paid = Number(rows[0].total);
    if (status === 'unpaid' || status === 'draft' || status === 'cancelled') paid = 0;
    let data = {};
    try { data = JSON.parse(rows[0].data); } catch (e) { /* ignore */ }
    data.status = status; data.amountPaid = paid;
    await db.query('UPDATE dbo.invoices SET status = ?, amount_paid = ?, data = ?, updated_by = ?, updated_at = SYSDATETIME() WHERE id = ?',
      [status, paid, JSON.stringify(data), req.user.id, id]);
    await db.log(req.user.id, 'status', 'invoice', id, status);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await db.query('SELECT number, created_by FROM dbo.invoices WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role !== 'admin' && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only an admin can delete invoices created by others' });
    }
    await db.query('DELETE FROM dbo.invoices WHERE id = ?', [id]);
    await db.log(req.user.id, 'delete', 'invoice', id, rows[0].number);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
