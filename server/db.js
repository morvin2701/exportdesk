/**
 * Database layer — Microsoft SQL Server via the `mssql` driver.
 *
 * Two modes:
 *  - SINGLE  (default): one SQL Server configured by the in-app wizard (server/config/db.json) or DB_* env vars.
 *  - MULTI   (REGISTRY_SERVER set): a registry database on YOUR server holds the table `exportdesklink` with one
 *            row per client (company code + the client's own SQL Server instance). Every request is served from
 *            that client's SQL Server; nothing of the client's data is stored centrally.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const sql = require('mssql');

const CONFIG_DIR = path.join(process.pkg ? path.dirname(process.execPath) : __dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'db.json');
const SECRET_FILE = path.join(CONFIG_DIR, 'secret.json');

// ---------------------------------------------------------------- helpers
function sanitizeIdentifier(name) { return String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, ''); }

/** Parse "SERVER\INSTANCE", "SERVER,PORT" or "SERVER" exactly like SSMS does. */
function parseServerName(serverName) {
  const raw = String(serverName || '').trim();
  let host = raw, instanceName, port;
  if (raw.includes('\\')) { const [h, inst] = raw.split('\\'); host = h; instanceName = inst; }
  if (host.includes(',')) { const [h, p] = host.split(','); host = h; port = Number(p) || undefined; }
  if (!host || host === '.' || host.toLowerCase() === '(local)' || host.toLowerCase() === 'localhost') host = '127.0.0.1';
  return { host: host.trim(), instanceName: instanceName ? instanceName.trim() : undefined, port };
}

function buildConfig(input, database) {
  const { host, instanceName, port } = parseServerName(input.server);
  const authType = input.authType === 'windows' ? 'windows' : 'sql';
  const cfg = {
    server: host,
    database: database || input.database || 'master',
    options: { encrypt: input.encrypt !== false, trustServerCertificate: true, enableArithAbort: true, useUTC: false, ...(instanceName ? { instanceName } : {}) },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 12000,
    requestTimeout: 30000,
  };
  const explicitPort = Number(input.port) || port;
  if (explicitPort) { cfg.port = explicitPort; delete cfg.options.instanceName; }
  if (authType === 'windows') {
    const domain = String(input.domain || '').trim() || (host !== '127.0.0.1' ? host.toUpperCase() : (os.hostname() || '').toUpperCase());
    cfg.authentication = { type: 'ntlm', options: { domain, userName: input.user || '', password: input.password || '' } };
  } else {
    cfg.user = input.user; cfg.password = input.password || '';
  }
  return cfg;
}

function isEncryptionError(e) {
  const msg = String((e && e.message) || '') + ' ' + String((e && e.originalError && e.originalError.message) || '');
  return /encrypt|ssl|tls|handshake|EPROTO|certificate|wrong version number/i.test(msg);
}

/** Open a pool; on TLS trouble retry once with the opposite encrypt flag. Returns { pool, encrypt }. */
async function openPool(input, database) {
  const first = input.encrypt !== false;
  try {
    const p = await new sql.ConnectionPool(buildConfig({ ...input, encrypt: first }, database)).connect();
    return { pool: p, encrypt: first };
  } catch (e) {
    if (!isEncryptionError(e) && e.code !== 'ESOCKET') throw e;
    try {
      const p = await new sql.ConnectionPool(buildConfig({ ...input, encrypt: !first }, database)).connect();
      return { pool: p, encrypt: !first };
    } catch (e2) { throw e; }
  }
}

function friendlyError(e) {
  const code = e && (e.code || (e.originalError && e.originalError.code));
  const msg = (e && e.message) || '';
  if (code === 'DB_NOT_CONFIGURED') return 'Database not configured';
  if (code === 'ESOCKET' || code === 'ECONNREFUSED') return 'Could not reach the SQL Server instance. Check: (1) the SQL Server service is running, (2) TCP/IP is enabled in SQL Server Configuration Manager, (3) for a named instance the "SQL Server Browser" service is running, (4) the firewall / router allows the port (1433 TCP, 1434 UDP for instance names).';
  if (code === 'EINSTLOOKUP') return 'Instance not found. Over the internet use "ip,port" (e.g. 103.1.2.3,1433) instead of the instance name, or make sure the "SQL Server Browser" service is running and UDP 1434 is open.';
  if (code === 'ELOGIN') return 'Login failed. Check the username/password, and make sure "SQL Server and Windows Authentication mode" is enabled (SSMS → Server → Properties → Security).';
  if (code === 'ETIMEOUT') return 'Connection timed out. Check the server address, TCP/IP settings, port forwarding and firewall.';
  if (code === 'ENOTFOUND') return 'Host not found. A Windows computer name only works on its own network — use the public IP or a DDNS hostname.';
  if (/Cannot open database/i.test(msg)) return 'The database exists but this login cannot open it. Grant access in SSMS or use a different login.';
  if (/CREATE DATABASE permission denied/i.test(msg)) return 'This login cannot create databases. Create the database in SSMS first, or use "sa" / an admin login.';
  return msg || 'Unknown database error';
}

// ---------------------------------------------------------------- secrets / encryption
function getSecret() {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  try { if (fs.existsSync(SECRET_FILE)) return JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).secret; } catch (e) { /* regenerate */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, JSON.stringify({ secret }), 'utf8');
  return secret;
}
function encKey() { return crypto.createHash('sha256').update(String(getSecret())).digest(); }
function encrypt(text) {
  if (text == null || text === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
function decrypt(blob) {
  if (!blob) return '';
  const s = String(blob);
  if (!s.startsWith('enc:v1:')) return s;
  const [, , iv, tag, data] = s.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- schemas
const SCHEMA = [
  `IF OBJECT_ID('dbo.users','U') IS NULL
   CREATE TABLE dbo.users (
     id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(120) NOT NULL, email NVARCHAR(190) NOT NULL UNIQUE, password_hash NVARCHAR(255) NOT NULL,
     role NVARCHAR(10) NOT NULL DEFAULT 'staff', active BIT NOT NULL DEFAULT 1, last_login DATETIME2 NULL,
     created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,
  `IF OBJECT_ID('dbo.settings','U') IS NULL
   CREATE TABLE dbo.settings ( [key] NVARCHAR(64) PRIMARY KEY, value NVARCHAR(MAX) NOT NULL, updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME() )`,
  `IF OBJECT_ID('dbo.customers','U') IS NULL
   CREATE TABLE dbo.customers (
     id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(190) NOT NULL UNIQUE, contact NVARCHAR(120) NULL, address NVARCHAR(MAX) NULL, city NVARCHAR(120) NULL,
     country NVARCHAR(120) NULL, phone NVARCHAR(60) NULL, email NVARCHAR(190) NULL, tax_id NVARCHAR(80) NULL,
     created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,
  `IF OBJECT_ID('dbo.invoices','U') IS NULL
   CREATE TABLE dbo.invoices (
     id INT IDENTITY(1,1) PRIMARY KEY, number NVARCHAR(60) NOT NULL UNIQUE, status NVARCHAR(12) NOT NULL DEFAULT 'unpaid', issue_date DATE NOT NULL, due_date DATE NULL,
     currency NVARCHAR(8) NOT NULL DEFAULT 'USD', customer_name NVARCHAR(190) NOT NULL, customer_country NVARCHAR(120) NULL,
     subtotal DECIMAL(16,2) NOT NULL DEFAULT 0, total DECIMAL(16,2) NOT NULL DEFAULT 0, amount_paid DECIMAL(16,2) NOT NULL DEFAULT 0, data NVARCHAR(MAX) NOT NULL,
     created_by INT NULL, updated_by INT NULL, created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_invoices_status') CREATE INDEX idx_invoices_status ON dbo.invoices(status)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_invoices_date') CREATE INDEX idx_invoices_date ON dbo.invoices(issue_date)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_invoices_customer') CREATE INDEX idx_invoices_customer ON dbo.invoices(customer_name)`,
  `IF OBJECT_ID('dbo.sequences','U') IS NULL CREATE TABLE dbo.sequences ( seq_key NVARCHAR(64) PRIMARY KEY, last_no INT NOT NULL DEFAULT 0 )`,
  `IF OBJECT_ID('dbo.activity_log','U') IS NULL
   CREATE TABLE dbo.activity_log (
     id INT IDENTITY(1,1) PRIMARY KEY, user_id INT NULL, action NVARCHAR(60) NOT NULL, entity NVARCHAR(60) NULL, entity_id NVARCHAR(80) NULL,
     details NVARCHAR(500) NULL, created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,
];

/** Registry (your server): one row per client company. */
const REGISTRY_SCHEMA = [
  `IF OBJECT_ID('dbo.exportdesklink','U') IS NULL
   CREATE TABLE dbo.exportdesklink (
     id INT IDENTITY(1,1) PRIMARY KEY,
     code NVARCHAR(40) NOT NULL UNIQUE,
     name NVARCHAR(190) NOT NULL,
     contact_name NVARCHAR(120) NULL, contact_email NVARCHAR(190) NULL, contact_phone NVARCHAR(60) NULL,
     db_server NVARCHAR(190) NULL, db_port INT NULL, db_auth NVARCHAR(10) NOT NULL DEFAULT 'sql', db_domain NVARCHAR(120) NULL,
     db_user NVARCHAR(120) NULL, db_password NVARCHAR(MAX) NULL, db_database NVARCHAR(128) NULL, db_encrypt BIT NOT NULL DEFAULT 1,
     db_ready BIT NOT NULL DEFAULT 0,
     activation_key NVARCHAR(64) NULL,
     active BIT NOT NULL DEFAULT 1,
     notes NVARCHAR(MAX) NULL,
     last_checked DATETIME2 NULL, last_status NVARCHAR(500) NULL,
     created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,
];

// ---------------------------------------------------------------- connection handle
/** A handle = one SQL Server database with a lazily-opened pool and the query helpers the routes use. */
function createHandle(cfg) {
  let pool = null;
  async function getPool() {
    if (pool) return pool;
    const opened = await openPool(cfg, cfg.database);
    pool = opened.pool;
    pool.on('error', err => { console.error('[db] pool error', err.message); pool = null; });
    return pool;
  }
  async function query(text, params = []) {
    const req = (await getPool()).request();
    let i = 0;
    const converted = text.replace(/\?/g, () => `@p${i++}`);
    params.forEach((v, idx) => req.input(`p${idx}`, v === undefined ? null : v));
    const result = await req.query(converted);
    return result.recordset || [];
  }
  async function insert(text, params = []) { const rows = await query(text, params); return rows.length ? rows[0].id : null; }
  async function getSetting(key, fallback = null) {
    const rows = await query('SELECT value FROM dbo.settings WHERE [key] = ?', [key]);
    if (!rows.length) return fallback;
    try { return JSON.parse(rows[0].value); } catch (e) { return fallback; }
  }
  async function setSetting(key, value) {
    await query(`MERGE dbo.settings AS t USING (SELECT ? AS k, ? AS v) AS s ON t.[key] = s.k
       WHEN MATCHED THEN UPDATE SET value = s.v, updated_at = SYSDATETIME()
       WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (s.k, s.v);`, [key, JSON.stringify(value)]);
  }
  async function log(userId, action, entity, entityId, details) {
    try {
      await query('INSERT INTO dbo.activity_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        [userId || null, action, entity || null, entityId != null ? String(entityId) : null, details ? String(details).slice(0, 500) : null]);
    } catch (e) { /* non-critical */ }
  }
  async function ping() { try { await query('SELECT 1 AS ok'); return true; } catch (e) { return false; } }
  async function ensureSchema(schema = SCHEMA) { for (const stmt of schema) await query(stmt); }
  async function close() { if (pool) { const p = pool; pool = null; await p.close().catch(() => {}); } }
  function publicConfig() { return { server: cfg.server, port: cfg.port || null, authType: cfg.authType || 'sql', domain: cfg.domain || '', user: cfg.user, database: cfg.database, encrypt: cfg.encrypt !== false, fromEnv: !!cfg.fromEnv }; }
  return { cfg, query, insert, getSetting, setSetting, log, ping, ensureSchema, close, publicConfig };
}

/** Test credentials against master. Returns version + database list (+ encrypt flag that worked). */
async function testConnection(input) {
  const opened = await openPool(input, 'master');
  try {
    const v = await opened.pool.request().query("SELECT SERVERPROPERTY('ProductVersion') AS version, SERVERPROPERTY('Edition') AS edition, @@SERVERNAME AS servername");
    const dbs = await opened.pool.request().query('SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name');
    return { version: v.recordset[0].version, edition: v.recordset[0].edition, serverName: v.recordset[0].servername, databases: dbs.recordset.map(r => r.name), encrypt: opened.encrypt };
  } finally { await opened.pool.close(); }
}

/** Create the database if missing + all tables. Returns { database, encrypt }. */
async function installSchema(input, schema = SCHEMA) {
  const dbName = sanitizeIdentifier(input.database);
  if (!dbName) throw new Error('Invalid database name. Use letters, numbers and underscores only.');
  const master = await openPool(input, 'master');
  try { await master.pool.request().query(`IF DB_ID('${dbName}') IS NULL CREATE DATABASE [${dbName}]`); }
  finally { await master.pool.close(); }
  const conn = await openPool({ ...input, encrypt: master.encrypt }, dbName);
  try { for (const stmt of schema) await conn.pool.request().query(stmt); }
  finally { await conn.pool.close(); }
  return { database: dbName, encrypt: master.encrypt };
}

// ---------------------------------------------------------------- SINGLE mode
let cachedConfig = null;
let localHandle = null;

function envConfig() {
  if (!process.env.DB_SERVER) return null;
  return {
    server: process.env.DB_SERVER, port: Number(process.env.DB_PORT) || null, authType: process.env.DB_AUTH === 'windows' ? 'windows' : 'sql',
    domain: process.env.DB_DOMAIN || '', user: process.env.DB_USER || '', password: process.env.DB_PASSWORD || '',
    encrypt: process.env.DB_ENCRYPT !== 'false' && process.env.DB_ENCRYPT !== '0', database: sanitizeIdentifier(process.env.DB_DATABASE || 'ExportDesk'), fromEnv: true,
  };
}
function readConfig() {
  if (cachedConfig) return cachedConfig;
  const env = envConfig();
  if (env) { cachedConfig = env; return env; }
  try { if (fs.existsSync(CONFIG_FILE)) { cachedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); return cachedConfig; } }
  catch (e) { console.error('[db] Failed to read config:', e.message); }
  return null;
}
function writeConfig(cfg) {
  if (localHandle) { localHandle.close(); localHandle = null; }
  cachedConfig = null;
  if (envConfig()) return;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  cachedConfig = cfg;
}
function isConfigured() { return !!readConfig(); }
function local() {
  const cfg = readConfig();
  if (!cfg) return null;
  if (!localHandle || localHandle.cfg !== cfg) localHandle = createHandle(cfg);
  return localHandle;
}
async function install(input) {
  const out = await installSchema(input);
  writeConfig({ server: String(input.server || '').trim(), port: Number(input.port) || null, authType: input.authType === 'windows' ? 'windows' : 'sql', domain: input.domain || '', user: input.user || '', password: input.password || '', encrypt: out.encrypt, database: out.database });
  return out;
}
function publicConfig() { const h = local(); return h ? h.publicConfig() : null; }

// ---------------------------------------------------------------- MULTI mode (registry on your server)
function registryConfig() {
  if (!process.env.REGISTRY_SERVER) return null;
  return {
    server: process.env.REGISTRY_SERVER, port: Number(process.env.REGISTRY_PORT) || null, authType: process.env.REGISTRY_AUTH === 'windows' ? 'windows' : 'sql',
    domain: process.env.REGISTRY_DOMAIN || '', user: process.env.REGISTRY_USER || '', password: process.env.REGISTRY_PASSWORD || '',
    encrypt: process.env.REGISTRY_ENCRYPT !== 'false' && process.env.REGISTRY_ENCRYPT !== '0', database: sanitizeIdentifier(process.env.REGISTRY_DATABASE || 'ExportDeskLink'),
  };
}
function isMulti() { return !!registryConfig(); }
let registryHandle = null;
function registry() {
  const cfg = registryConfig();
  if (!cfg) throw Object.assign(new Error('Registry not configured'), { code: 'DB_NOT_CONFIGURED' });
  if (!registryHandle) registryHandle = createHandle(cfg);
  return registryHandle;
}
async function ensureRegistry() { await installSchema(registryConfig(), REGISTRY_SCHEMA); }

function tenantConfig(row) {
  return { server: row.db_server || '', port: row.db_port || null, authType: row.db_auth === 'windows' ? 'windows' : 'sql', domain: row.db_domain || '', user: row.db_user || '', password: decrypt(row.db_password), encrypt: row.db_encrypt !== false && row.db_encrypt !== 0, database: sanitizeIdentifier(row.db_database || `ExportDesk_${row.code}`) };
}
const tenantHandles = new Map(); // id -> { sig, handle }
function tenantHandle(row) {
  const cfg = tenantConfig(row);
  const sig = JSON.stringify(cfg);
  const cached = tenantHandles.get(row.id);
  if (cached && cached.sig === sig) return cached.handle;
  if (cached) cached.handle.close();
  const handle = createHandle(cfg);
  tenantHandles.set(row.id, { sig, handle });
  return handle;
}
function invalidateTenant(id) { const c = tenantHandles.get(id); if (c) { c.handle.close(); tenantHandles.delete(id); } }
async function getTenantByCode(code) {
  const rows = await registry().query('SELECT TOP 1 * FROM dbo.exportdesklink WHERE code = ?', [String(code || '').trim().toUpperCase()]);
  return rows[0] || null;
}
async function getTenantById(id) {
  const rows = await registry().query('SELECT TOP 1 * FROM dbo.exportdesklink WHERE id = ?', [Number(id)]);
  return rows[0] || null;
}
function publicTenant(row) {
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, contact_name: row.contact_name, contact_email: row.contact_email, contact_phone: row.contact_phone,
    db_server: row.db_server, db_port: row.db_port, db_auth: row.db_auth, db_domain: row.db_domain, db_user: row.db_user, db_database: row.db_database,
    db_encrypt: !!row.db_encrypt, db_ready: !!row.db_ready, has_password: !!row.db_password, activation_key: row.activation_key, active: !!row.active, notes: row.notes,
    last_checked: row.last_checked, last_status: row.last_status, created_at: row.created_at, updated_at: row.updated_at };
}

module.exports = {
  parseServerName, friendlyError, testConnection, installSchema, SCHEMA, REGISTRY_SCHEMA, createHandle, sanitizeIdentifier, getSecret, encrypt, decrypt,
  readConfig, writeConfig, isConfigured, local, install, publicConfig,
  isMulti, registryConfig, registry, ensureRegistry, tenantConfig, tenantHandle, invalidateTenant, getTenantByCode, getTenantById, publicTenant,
};
