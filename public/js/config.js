/**
 * Frontend configuration.
 *
 * apiBase:
 *   ''                              → API on the same origin (default: app served by the Node server, or Vercel rewrites proxying /api)
 *   'https://api.yourdomain.com'    → API on a different domain (needs CORS_ORIGIN + COOKIE_SAMESITE=none on the backend)
 */
window.XD_CONFIG = window.XD_CONFIG || {};
window.XD_CONFIG.apiBase = window.XD_CONFIG.apiBase || '';
