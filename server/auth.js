const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET_FILE = path.join(__dirname, 'config', 'secret.json');
const COOKIE = 'xd_session';
const TOKEN_DAYS = 7;

function getSecret() {
  try {
    if (fs.existsSync(SECRET_FILE)) return JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).secret;
  } catch (e) { /* regenerate */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, JSON.stringify({ secret }), 'utf8');
  return secret;
}

function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, getSecret(), { expiresIn: `${TOKEN_DAYS}d` });
}

function cookieOptions() {
  const sameSiteEnv = String(process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const sameSite = ['lax', 'strict', 'none'].includes(sameSiteEnv) ? sameSiteEnv : 'lax';
  const secure = process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true' || sameSite === 'none';
  return { httpOnly: true, sameSite, secure, path: '/' };
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: TOKEN_DAYS * 24 * 60 * 60 * 1000 });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE, cookieOptions());
}

/** Attaches req.user if a valid session cookie exists. Never fails the request. */
async function attachUser(req, res, next) {
  req.user = null;
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.cookies && req.cookies[COOKIE]);
  if (!token || !db.isConfigured()) return next();
  try {
    const payload = jwt.verify(token, getSecret());
    const rows = await db.query('SELECT id, name, email, role, active FROM users WHERE id = ? LIMIT 1', [payload.uid]);
    if (rows.length && rows[0].active) req.user = rows[0];
  } catch (e) { /* invalid token */ }
  next();
}

function requireAuth(req, res, next) {
  if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured', code: 'DB_NOT_CONFIGURED' });
  if (!req.user) return res.status(401).json({ error: 'Please sign in', code: 'UNAUTHENTICATED' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in', code: 'UNAUTHENTICATED' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
  next();
}

module.exports = { signToken, setSessionCookie, clearSessionCookie, attachUser, requireAuth, requireAdmin };
