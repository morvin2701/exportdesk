/**
 * Database layer — Microsoft SQL Server (SQL Express / named instance on the user's own PC).
 *
 * - The instance details entered in the in-app setup wizard are saved to server/config/db.json
 * - Connects by instance name (e.g. DESKTOP-PC\SQLEXPRESS) or by host + port
 * - Supports SQL Server authentication and Windows (NTLM) authentication
 * - Creates the database and all tables automatically
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'db.json');

let pool = null;
let cachedConfig = null;

/** Connection details can also come from environment variables (server/.env) — they take precedence over db.json. */
function envConfig() {
  if (!process.env.DB_SERVER) return null;
  return {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT) || null,
    authType: process.env.DB_AUTH === 'windows' ? 'windows' : 'sql',
    domain: process.env.DB_DOMAIN || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    encrypt: process.env.DB_ENCRYPT !== 'false' && process.env.DB_ENCRYPT !== '0',
    database: sanitizeIdentifier(process.env.DB_DATABASE || 'ExportDesk'),
    fromEnv: true,
  };
}

function readConfig() {
  if (cachedConfig) return cachedConfig;
  const env = envConfig();
  if (env) { cachedConfig = env; return env; }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cachedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return cachedConfig;
    }
  } catch (e) {
    console.error('[db] Failed to read config:', e.message);
  }
  return null;
}

function writeConfig(cfg) {
  if (envConfig()) { cachedConfig = null; if (pool) { pool.close().catch(() => {}); pool = null; } return; } // env wins; nothing to persist
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  cachedConfig = cfg;
  if (pool) { pool.close().catch(() => {}); pool = null; }
}

function isConfigured() {
  return !!readConfig();
}

function sanitizeIdentifier(name) {
  return String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Parse "SERVER\INSTANCE" or "SERVER,PORT" or "SERVER" exactly like SSMS does.
 */
function parseServerName(serverName) {
  const raw = String(serverName || '').trim();
  let host = raw, instanceName = undefined, port = undefined;
  if (raw.includes('\\')) {
    const [h, inst] = raw.split('\\');
    host = h; instanceName = inst;
  }
  if (host.includes(',')) {
    const [h, p] = host.split(',');
    host = h; port = Number(p) || undefined;
  }
  if (!host || host === '.' || host.toLowerCase() === '(local)' || host.toLowerCase() === 'localhost') host = '127.0.0.1';
  return { host, instanceName, port };
}

/** Build an mssql config object from the saved/entered details. */
function buildConfig(input, database) {
  const { host, instanceName, port } = parseServerName(input.server);
  const authType = input.authType === 'windows' ? 'windows' : 'sql';
  const cfg = {
    server: host,
    database: database || input.database || 'master',
    options: {
      encrypt: input.encrypt !== false,
      trustServerCertificate: true,
      enableArithAbort: true,
      useUTC: false,
      ...(instanceName ? { instanceName } : {}),
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 10000,
    requestTimeout: 30000,
  };
  const explicitPort = Number(input.port) || port;
  if (explicitPort && !instanceName) cfg.port = explicitPort;

  if (authType === 'windows') {
    // NTLM needs a domain; for a local Windows account the domain is the PC name (taken from the server name if not given)
    const domain = String(input.domain || '').trim() || (host !== '127.0.0.1' ? host.toUpperCase() : (require('os').hostname() || '').toUpperCase());
    cfg.authentication = {
      type: 'ntlm',
      options: { domain, userName: input.user || '', password: input.password || '' },
    };
  } else {
    cfg.user = input.user;
    cfg.password = input.password || '';
  }
  return cfg;
}

function isEncryptionError(e) {
  const msg = String((e && e.message) || '') + ' ' + String((e && e.originalError && e.originalError.message) || '');
  return /encrypt|ssl|tls|handshake|EPROTO|certificate|wrong version number/i.test(msg);
}

/**
 * Open a pool; if the TLS/encryption negotiation fails, retry once with the opposite encrypt setting.
 * Returns { pool, encrypt } so callers can persist the setting that actually worked.
 */
async function openPool(input, database) {
  const first = input.encrypt !== false;
  try {
    const p = await new sql.ConnectionPool(buildConfig({ ...input, encrypt: first }, database)).connect();
    return { pool: p, encrypt: first };
  } catch (e) {
    if (!isEncryptionError(e) && (e.code !== 'ESOCKET')) throw e;
    try {
      const p = await new sql.ConnectionPool(buildConfig({ ...input, encrypt: !first }, database)).connect();
      return { pool: p, encrypt: !first };
    } catch (e2) {
      throw e;
    }
  }
}

async function getPool() {
  if (pool) return pool;
  const cfg = readConfig();
  if (!cfg) throw Object.assign(new Error('Database not configured'), { code: 'DB_NOT_CONFIGURED' });
  const opened = await openPool(cfg, cfg.database);
  pool = opened.pool;
  pool.on('error', err => { console.error('[db] pool error', err.message); pool = null; });
  return pool;
}

/**
 * Run a query with positional `?` placeholders (converted to @p0, @p1 ...).
 * Returns the recordset (array of rows).
 */
async function query(text, params = []) {
  const p = await getPool();
  const req = p.request();
  let i = 0;
  const converted = text.replace(/\?/g, () => `@p${i++}`);
  params.forEach((v, idx) => req.input(`p${idx}`, v === undefined ? null : v));
  const result = await req.query(converted);
  return result.recordset || [];
}

/** Insert and return the new identity id. SQL text must include `OUTPUT INSERTED.id`. */
async function insert(text, params = []) {
  const rows = await query(text, params);
  return rows.length ? rows[0].id : null;
}

/** Test raw server credentials against master. Returns version + database list. */
async function testConnection(input) {
  const opened = await openPool(input, 'master');
  const conn = opened.pool;
  try {
    const v = await conn.request().query("SELECT SERVERPROPERTY('ProductVersion') AS version, SERVERPROPERTY('Edition') AS edition, @@SERVERNAME AS servername");
    const dbs = await conn.request().query('SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name');
    return {
      version: v.recordset[0].version,
      edition: v.recordset[0].edition,
      serverName: v.recordset[0].servername,
      databases: dbs.recordset.map(r => r.name),
      encrypt: opened.encrypt,
    };
  } finally {
    await conn.close();
  }
}

const SCHEMA = [
  `IF OBJECT_ID('dbo.users','U') IS NULL
   CREATE TABLE dbo.users (
     id INT IDENTITY(1,1) PRIMARY KEY,
     name NVARCHAR(120) NOT NULL,
     email NVARCHAR(190) NOT NULL UNIQUE,
     password_hash NVARCHAR(255) NOT NULL,
     role NVARCHAR(10) NOT NULL DEFAULT 'staff',
     active BIT NOT NULL DEFAULT 1,
     last_login DATETIME2 NULL,
     created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
     updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,

  `IF OBJECT_ID('dbo.settings','U') IS NULL
   CREATE TABLE dbo.settings (
     [key] NVARCHAR(64) PRIMARY KEY,
     value NVARCHAR(MAX) NOT NULL,
     updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,

  `IF OBJECT_ID('dbo.customers','U') IS NULL
   CREATE TABLE dbo.customers (
     id INT IDENTITY(1,1) PRIMARY KEY,
     name NVARCHAR(190) NOT NULL UNIQUE,
     contact NVARCHAR(120) NULL,
     address NVARCHAR(MAX) NULL,
     city NVARCHAR(120) NULL,
     country NVARCHAR(120) NULL,
     phone NVARCHAR(60) NULL,
     email NVARCHAR(190) NULL,
     tax_id NVARCHAR(80) NULL,
     created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
     updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,

  `IF OBJECT_ID('dbo.invoices','U') IS NULL
   CREATE TABLE dbo.invoices (
     id INT IDENTITY(1,1) PRIMARY KEY,
     number NVARCHAR(60) NOT NULL UNIQUE,
     status NVARCHAR(12) NOT NULL DEFAULT 'unpaid',
     issue_date DATE NOT NULL,
     due_date DATE NULL,
     currency NVARCHAR(8) NOT NULL DEFAULT 'USD',
     customer_name NVARCHAR(190) NOT NULL,
     customer_country NVARCHAR(120) NULL,
     subtotal DECIMAL(16,2) NOT NULL DEFAULT 0,
     total DECIMAL(16,2) NOT NULL DEFAULT 0,
     amount_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
     data NVARCHAR(MAX) NOT NULL,
     created_by INT NULL,
     updated_by INT NULL,
     created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
     updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_invoices_status') CREATE INDEX idx_invoices_status ON dbo.invoices(status)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_invoices_date') CREATE INDEX idx_invoices_date ON dbo.invoices(issue_date)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_invoices_customer') CREATE INDEX idx_invoices_customer ON dbo.invoices(customer_name)`,

  `IF OBJECT_ID('dbo.sequences','U') IS NULL
   CREATE TABLE dbo.sequences (
     seq_key NVARCHAR(64) PRIMARY KEY,
     last_no INT NOT NULL DEFAULT 0
   )`,

  `IF OBJECT_ID('dbo.activity_log','U') IS NULL
   CREATE TABLE dbo.activity_log (
     id INT IDENTITY(1,1) PRIMARY KEY,
     user_id INT NULL,
     action NVARCHAR(60) NOT NULL,
     entity NVARCHAR(60) NULL,
     entity_id NVARCHAR(80) NULL,
     details NVARCHAR(500) NULL,
     created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
   )`,
];

/** Create database (if missing) + tables, then persist the instance config. */
async function install(input) {
  const dbName = sanitizeIdentifier(input.database);
  if (!dbName) throw new Error('Invalid database name. Use letters, numbers and underscores only.');

  const openedMaster = await openPool(input, 'master');
  const master = openedMaster.pool;
  try {
    await master.request().query(`IF DB_ID('${dbName}') IS NULL CREATE DATABASE [${dbName}]`);
  } finally {
    await master.close();
  }

  const encrypt = openedMaster.encrypt;
  const conn = (await openPool({ ...input, encrypt }, dbName)).pool;
  try {
    for (const stmt of SCHEMA) await conn.request().query(stmt);
  } finally {
    await conn.close();
  }

  writeConfig({
    server: String(input.server || '').trim(),
    port: Number(input.port) || null,
    authType: input.authType === 'windows' ? 'windows' : 'sql',
    domain: input.domain || '',
    user: input.user || '',
    password: input.password || '',
    encrypt,
    database: dbName,
  });
  return { database: dbName };
}

/** Ensure tables exist on an already-configured DB (safe on every boot). */
async function ensureSchema() {
  if (!readConfig()) return false;
  for (const stmt of SCHEMA) await query(stmt);
  return true;
}

async function ping() {
  try { await query('SELECT 1 AS ok'); return true; } catch (e) { return false; }
}

function publicConfig() {
  const cfg = readConfig();
  if (!cfg) return null;
  return { server: cfg.server, port: cfg.port, authType: cfg.authType, domain: cfg.domain, user: cfg.user, database: cfg.database, encrypt: cfg.encrypt, fromEnv: !!cfg.fromEnv };
}

async function getSetting(key, fallback = null) {
  const rows = await query('SELECT value FROM dbo.settings WHERE [key] = ?', [key]);
  if (!rows.length) return fallback;
  try { return JSON.parse(rows[0].value); } catch (e) { return fallback; }
}

async function setSetting(key, value) {
  const json = JSON.stringify(value);
  await query(
    `MERGE dbo.settings AS t USING (SELECT ? AS k, ? AS v) AS s ON t.[key] = s.k
     WHEN MATCHED THEN UPDATE SET value = s.v, updated_at = SYSDATETIME()
     WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (s.k, s.v);`,
    [key, json]
  );
}

async function log(userId, action, entity, entityId, details) {
  try {
    await query('INSERT INTO dbo.activity_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [userId || null, action, entity || null, entityId != null ? String(entityId) : null, details ? String(details).slice(0, 500) : null]);
  } catch (e) { /* non-critical */ }
}

function friendlyError(e) {
  const code = e && (e.code || (e.originalError && e.originalError.code));
  const msg = (e && e.message) || '';
  if (code === 'ESOCKET' || code === 'ECONNREFUSED') {
    return 'Could not reach the SQL Server instance. Check: (1) the SQL Server service is running, (2) TCP/IP is enabled in SQL Server Configuration Manager, (3) for a named instance, the "SQL Server Browser" service is running, (4) Windows Firewall allows the connection.';
  }
  if (code === 'EINSTLOOKUP') return 'Instance not found. Check the instance name and make sure the "SQL Server Browser" service is running.';
  if (code === 'ELOGIN') return 'Login failed. Check the username/password, and make sure "SQL Server and Windows Authentication mode" is enabled in the server properties (SSMS → Server → Properties → Security).';
  if (code === 'ETIMEOUT') return 'Connection timed out. Check the server name, TCP/IP settings and firewall.';
  if (/Cannot open database/i.test(msg)) return 'The database exists but this login cannot open it. Grant access in SSMS or use a different login.';
  if (/CREATE DATABASE permission denied/i.test(msg)) return 'This login cannot create databases. Create the database in SSMS first, or use the "sa" / an admin login.';
  return msg || 'Unknown database error';
}

module.exports = { readConfig, writeConfig, isConfigured, getPool, query, insert, testConnection, install, ensureSchema, ping, publicConfig, getSetting, setSetting, log, friendlyError, parseServerName };
