/**
 * Frontend configuration.
 *
 * apiBase:  ''  → API on the same origin (Node serves the app, or Vercel rewrites proxy /api to your server)
 *           'https://api.yourdomain.com' → API on another domain (needs CORS_ORIGIN + COOKIE_SAMESITE=none on the backend)
 * tenant:   ''  → users type their company code on the sign-in screen (multi-client mode)
 *           'ACME' → this deployment is locked to one client; the code field is hidden
 */
window.XD_CONFIG = window.XD_CONFIG || {};
window.XD_CONFIG.apiBase = window.XD_CONFIG.apiBase || '';
window.XD_CONFIG.tenant = window.XD_CONFIG.tenant || '';
