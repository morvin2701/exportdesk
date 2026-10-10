/** Tiny fetch wrapper for the API (same origin by default, or XD_CONFIG.apiBase). */
export const API_BASE = String((window.XD_CONFIG && window.XD_CONFIG.apiBase) || '').replace(/\/+$/, '');
export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

const TOKEN_KEY = 'xd_token';
export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
export function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

async function request(method, path, body) {
  const opts = { method, headers: {}, credentials: 'include' };
  const token = getToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (e) {
    throw new ApiError('Cannot reach the server. Is it running?', 0, 'NETWORK');
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { error: text }; }
  if (res.ok && data && data.token) setToken(data.token); // login / first-admin responses carry a session token
  if (!res.ok) {
    const err = new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.code);
    if (err.code === 'DB_NOT_CONFIGURED') window.dispatchEvent(new CustomEvent('app:db-missing'));
    else if (res.status === 401) window.dispatchEvent(new CustomEvent('app:unauthenticated'));
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};
