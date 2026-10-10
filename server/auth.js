const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const COOKIE = 'xd_session';
const TOKEN_DAYS = 7;

function signToken(payload) { return jwt.sign(payload, db.getSecret(), { expiresIn: `${TOKEN_DAYS}d` }); }
function userToken(user, tenantId) { return signToken({ uid: user.id, role: user.role, t: tenantId || null }); }
function platformToken(email) { return signToken({ p: true, email }); }

function cookieOptions() {
  const sameSiteEnv = String(process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const sameSite = ['lax', 'strict', 'none'].includes(sameSiteEnv) ? sameSiteEnv : 'lax';
  const secure = process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true' || sameSite === 'none';
  return { httpOnly: true, sameSite, secure, path: '/' };
}
function setSessionCookie(res, token) { res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: TOKEN_DAYS * 24 * 60 * 60 * 1000 }); }
function clearSessionCookie(res) { res.clearCookie(COOKIE, cookieOptions()); }

// ---- platform owner (you) — credentials from .env ----
function platformEnabled() { return !!(process.env.PLATFORM_ADMIN_EMAIL && process.env.PLATFORM_ADMIN_PASSWORD); }
async function verifyPlatform(email, password) {
  if (!platformEnabled()) return false;
  if (String(email || '').trim().toLowerCase() !== String(process.env.PLATFORM_ADMIN_EMAIL).trim().toLowerCase()) return false;
  const stored = String(process.env.PLATFORM_ADMIN_PASSWORD);
  if (stored.startsWith('$2')) return bcrypt.compare(String(password || ''), stored);
  return String(password || '') === stored;
}

/**
 * Resolves the database for this request and the signed-in user (if any). Never fails the request.
 *   single mode: req.db = the one configured database
 *   multi mode : req.db = the client's database from the token's tenant id (req.tenant = registry row)
 *                platform owner tokens set req.platformAdmin instead
 */
async function attachUser(req, res, next) {
  req.user = null; req.tenant = null; req.platformAdmin = null; req.db = null;
  if (!db.isMulti()) req.db = db.local();
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.cookies && req.cookies[COOKIE]);
  if (!token) return next();
  let payload;
  try { payload = jwt.verify(token, db.getSecret()); } catch (e) { return next(); }
  try {
    if (payload.p) {
      if (platformEnabled() && String(payload.email).toLowerCase() === String(process.env.PLATFORM_ADMIN_EMAIL).toLowerCase()) req.platformAdmin = { email: payload.email };
      return next();
    }
    if (db.isMulti()) {
      if (!payload.t) return next();
      const tenant = await db.getTenantById(payload.t);
      if (!tenant || !tenant.active) return next();
      req.tenant = tenant;
      req.db = db.tenantHandle(tenant);
    }
    if (!req.db) return next();
    const rows = await req.db.query('SELECT id, name, email, role, active FROM dbo.users WHERE id = ?', [payload.uid]);
    if (rows.length && rows[0].active) req.user = rows[0];
  } catch (e) { /* db unreachable → treated as signed out */ }
  next();
}

function requireAuth(req, res, next) {
  if (!req.db) return res.status(503).json({ error: db.isMulti() ? 'Please sign in with your company code' : 'Database not configured', code: db.isMulti() ? 'UNAUTHENTICATED' : 'DB_NOT_CONFIGURED' });
  if (!req.user) return res.status(401).json({ error: 'Please sign in', code: 'UNAUTHENTICATED' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in', code: 'UNAUTHENTICATED' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
  next();
}
function requirePlatform(req, res, next) {
  if (!req.platformAdmin) return res.status(403).json({ error: 'Platform owner access required', code: 'FORBIDDEN' });
  next();
}

module.exports = { signToken, userToken, platformToken, setSessionCookie, clearSessionCookie, attachUser, requireAuth, requireAdmin, requirePlatform, platformEnabled, verifyPlatform };
