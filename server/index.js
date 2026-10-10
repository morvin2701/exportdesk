/**
 * ExportDesk — local server.
 * Run:  npm install  →  npm start  →  open http://localhost:4000
 */
require('./env');
const path = require('path');
const os = require('os');
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { attachUser } = require('./auth');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0'; // 127.0.0.1 = only a reverse proxy on this machine can reach Node
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // correct secure-cookie / IP handling behind nginx, Caddy, IIS, Cloudflare

// ---- CORS (only when the frontend is hosted on another origin, e.g. Vercel without rewrites) ----
const ALLOWED_ORIGINS = String(process.env.CORS_ORIGIN || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
if (ALLOWED_ORIGINS.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use(express.json({ limit: '30mb' }));
app.use(cookieParser());
app.use(attachUser);

// ---- API ----
app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/platform', require('./routes/platform'));
app.use('/api/tenant', require('./routes/tenant'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/users', require('./routes/users'));
app.use('/api/customers', require('./routes/customers'));
app.get('/api/health', (req, res) => res.json({ ok: true, mode: db.isMulti() ? 'multi' : 'single', configured: db.isMulti() || db.isConfigured(), time: new Date().toISOString() }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Static frontend (only present in the all-in-one layout; on a server-only deployment the frontend lives on Vercel) ----
const PUBLIC_DIR = process.pkg ? path.join(path.dirname(process.execPath), 'public') : path.join(__dirname, '..', 'public');
const HAS_FRONTEND = require('fs').existsSync(path.join(PUBLIC_DIR, 'index.html'));
if (HAS_FRONTEND) {
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0 }));
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
} else {
  app.get('/', (req, res) => res.type('text').send('ExportDesk API is running. The web app is served from Vercel; this server only answers /api/*.'));
}

// ---- Error handler ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server]', err);
  if (err && err.code === 'DB_NOT_CONFIGURED') return res.status(503).json({ error: 'Database not configured', code: 'DB_NOT_CONFIGURED' });
  res.status(500).json({ error: (err && err.message) || 'Server error' });
});

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`${i.address} (${name})`);
  }
  return out;
}

(async () => {
  if (db.isMulti()) {
    try {
      await db.ensureRegistry();
      const n = await db.registry().query('SELECT COUNT(*) AS c FROM dbo.exportdesklink');
      console.log(`[db] MULTI-TENANT mode · registry "${db.registryConfig().server}" · database "${db.registryConfig().database}" · ${n[0].c} client(s)`);
      if (!require('./auth').platformEnabled()) console.warn('[auth] PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD not set — the Clients page cannot be opened.');
    } catch (e) {
      console.error('[db] Registry database not reachable:', db.friendlyError(e));
    }
  } else if (db.isConfigured()) {
    try {
      const cfg = db.readConfig();
      if (cfg.fromEnv) await db.install(cfg); else await db.local().ensureSchema();
      console.log(`[db] Connected to SQL Server "${db.publicConfig().server}" · database "${db.publicConfig().database}"`);
    } catch (e) {
      console.warn('[db] Could not connect to the configured SQL Server instance:', db.friendlyError(e));
      console.warn('[db] Open the app in the browser to fix the connection.');
    }
  } else {
    console.log('[db] No database configured yet — the setup wizard will open in the browser.');
  }
  app.listen(PORT, HOST, () => {
    console.log('');
    console.log(`  ExportDesk API is running (${HAS_FRONTEND ? 'serving frontend + API' : 'API only'})`);
    if (ALLOWED_ORIGINS.length) console.log(`  CORS:     ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`  Local:    http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') for (const a of lanAddresses()) console.log(`  Network:  http://${a.split(' ')[0]}:${PORT}`);
    else console.log(`  Bound to ${HOST} only (reverse proxy mode)`);
    console.log('');
  });
})();
