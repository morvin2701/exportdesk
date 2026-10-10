/** App shell: boot, router, sidebar/topbar, global state. Works in single-client and multi-client (registry) mode. */
import { api, setToken } from './api.js';
import { h, icon, esc, toast, initials, confirmDialog } from './ui.js';

export const store = {
  status: null,
  user: null,
  platform: null,   // { email } when signed in as platform owner (multi mode)
  tenant: null,     // { code, name, ... } in multi mode
  settings: null,
  theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
};
export const isMulti = () => !!(store.status && store.status.mode === 'multi');

const ROUTES = {
  editor: { title: 'Invoice Editor', sub: 'Create and preview an export invoice', module: './pages/editor.js', nav: true, icon: 'editor', label: 'New Invoice', kbd: 'N' },
  invoices: { title: 'Saved Invoices', sub: 'Everything you have issued', module: './pages/saved.js', nav: true, icon: 'saved', label: 'Saved Invoices', kbd: 'I' },
  settings: { title: 'Settings', sub: 'Company profile, branding, numbering, bank & database', module: './pages/settings.js', nav: true, icon: 'settings', label: 'Settings', kbd: 'S' },
  team: { title: 'Team', sub: 'Users, roles and activity', module: './pages/team.js', nav: true, icon: 'team', label: 'Team', kbd: 'T', admin: true },
  clients: { title: 'Clients', sub: 'Companies using ExportDesk and their SQL Server connections', module: './pages/clients.js', nav: true, icon: 'globe', label: 'Clients', kbd: 'C', platform: true },
};

let shellEl = null;
let pageRoot = null;
let currentCleanup = null;
let currentRoute = null;
let navGuard = null;

export function setNavGuard(fn) { navGuard = fn; }

export function parseHash() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  return { name: parts[0] || '', id: parts[1] || null, params };
}

export function navigate(hash) {
  if (location.hash === hash) { render(); return; }
  location.hash = hash;
}

export async function loadSettings(force = false) {
  if (store.settings && !force) return store.settings;
  store.settings = await api.get('/api/settings');
  return store.settings;
}

export function setTopbar({ title, sub } = {}) {
  if (!shellEl) return;
  const t = shellEl.querySelector('.tb-title'); const s = shellEl.querySelector('.tb-sub');
  if (t && title != null) t.textContent = title;
  if (s && sub != null) s.textContent = sub;
}

export function toggleTheme() {
  store.theme = store.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', store.theme);
  try { localStorage.setItem('xd-theme', store.theme); } catch (e) { /* ignore */ }
  const b = document.querySelector('[data-act="theme"]');
  if (b) b.innerHTML = icon(store.theme === 'dark' ? 'sun' : 'moon');
}

export async function logout() {
  if (navGuard && !(await navGuard())) return;
  try { await api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
  setToken('');
  store.user = null; store.platform = null; store.tenant = null; store.settings = null;
  shellEl = null; pageRoot = null; currentRoute = null;
  await refreshStatus().catch(() => {});
  navigate('#/login');
  render();
}

function defaultRoute() { return store.platform ? 'clients' : 'editor'; }

// ---------- Shell ----------
function buildShell() {
  const platform = !!store.platform;
  const user = store.user;
  const collapsed = (() => { try { return localStorage.getItem('xd-sb') === '1'; } catch (e) { return false; } })();
  const navItems = Object.entries(ROUTES)
    .filter(([, r]) => r.nav && (platform ? r.platform : (!r.platform && (!r.admin || user.role === 'admin'))))
    .map(([k, r]) => `<button class="nav-item" data-route="${k}">${icon(r.icon)}<span>${esc(r.label)}</span><span class="nav-kbd">${r.kbd}</span></button>`).join('');
  const brand = platform ? 'ExportDesk' : ((store.settings && store.settings.company && store.settings.company.name) || (store.tenant && store.tenant.name) || 'ExportDesk');
  const brandSub = platform ? 'Platform owner' : 'Export Invoicing';
  const who = platform ? { name: store.platform.email, role: 'Platform owner', initials: 'PO' } : { name: user.name, role: user.role === 'admin' ? 'Administrator' : 'Staff', initials: initials(user.name) };
  const statusText = platform ? 'Registry connected' : (isMulti() ? `${(store.tenant && store.tenant.name) || ''}` : ((store.status && store.status.db && store.status.db.server) || 'Connected'));

  shellEl = h(`<div class="shell ${collapsed ? 'collapsed' : ''}">
    <aside class="sidebar">
      <div class="sb-brand">
        <div class="sb-logo">${icon('logo')}</div>
        <div class="sb-brand-text"><div class="sb-brand-name">${esc(brand)}</div><div class="sb-brand-sub">${esc(brandSub)}</div></div>
      </div>
      <div class="sb-section">${platform ? 'Platform' : 'Workspace'}</div>
      ${navItems}
      <div class="sb-spacer"></div>
      <div class="sb-user">
        <div class="avatar">${esc(who.initials)}</div>
        <div class="sb-user-text"><div class="sb-user-name">${esc(who.name)}</div><div class="sb-user-role">${esc(who.role)}</div></div>
        <button class="icon-btn" data-act="logout" title="Sign out" style="color:#94a3b8">${icon('logout')}</button>
      </div>
    </aside>
    <div class="sb-backdrop"></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${icon('menu')}</button>
        <button class="icon-btn sb-toggle" data-act="collapse" title="Collapse sidebar">${icon('layout')}</button>
        <div class="tb-heading"><div class="tb-title"></div><div class="tb-sub"></div></div>
        <div class="tb-actions"></div>
        <div class="tb-right">
          <div class="tb-status" title="${platform ? 'Registry database' : 'SQL Server connection'}"><span class="dot"></span><span class="txt">${esc(statusText)}</span></div>
          <button class="icon-btn" data-act="theme" title="Toggle theme">${icon(store.theme === 'dark' ? 'sun' : 'moon')}</button>
          ${platform ? `<button class="btn btn-primary btn-sm" data-act="new-client">${icon('plus')}<span class="hide-sm">Add client</span></button>` : `<button class="btn btn-primary btn-sm" data-act="new">${icon('plus')}<span class="hide-sm">New Invoice</span></button>`}
        </div>
      </header>
      <div class="page-root"></div>
    </div>
  </div>`);

  pageRoot = shellEl.querySelector('.page-root');
  shellEl.addEventListener('click', async e => {
    const nav = e.target.closest('[data-route]');
    if (nav) { closeMobileNav(); navigate(`#/${nav.dataset.route}`); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'logout') logout();
    if (a === 'theme') toggleTheme();
    if (a === 'new') { navigate('#/editor?new=1'); if (currentRoute === 'editor') render(); }
    if (a === 'new-client') { navigate('#/clients?new=1'); if (currentRoute === 'clients') render(); }
    if (a === 'menu') { shellEl.querySelector('.sidebar').classList.toggle('open'); shellEl.querySelector('.sb-backdrop').classList.toggle('show'); }
    if (a === 'collapse') { shellEl.classList.toggle('collapsed'); try { localStorage.setItem('xd-sb', shellEl.classList.contains('collapsed') ? '1' : '0'); } catch (err) { /* ignore */ } }
  });
  shellEl.querySelector('.sb-backdrop').addEventListener('click', closeMobileNav);
  document.getElementById('app').replaceChildren(shellEl);
}

function closeMobileNav() {
  if (!shellEl) return;
  shellEl.querySelector('.sidebar').classList.remove('open');
  shellEl.querySelector('.sb-backdrop').classList.remove('show');
}

function markActive(name) {
  if (!shellEl) return;
  shellEl.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === name));
}

async function renderFullscreen(modulePath, params) {
  shellEl = null; pageRoot = null; currentRoute = null;
  const root = document.getElementById('app');
  root.replaceChildren();
  if (currentCleanup) { try { currentCleanup(); } catch (e) { /* ignore */ } currentCleanup = null; }
  const mod = await import(modulePath);
  currentCleanup = await mod.render(root, params) || null;
  lastRenderedHash = location.hash;
}

let rendering = false;
let pendingRender = false;
let lastRenderedHash = null;
export async function render() {
  if (rendering) { pendingRender = true; return; }
  rendering = true;
  try {
    const route = parseHash();
    const st = store.status;
    const multi = isMulti();

    if (!multi) {
      if (!st || !st.configured || !st.connected) { await renderFullscreen('./pages/setup.js', { step: 'db' }); return; }
      if (!st.hasUsers) { await renderFullscreen('./pages/setup.js', { step: 'admin' }); return; }
    }
    if (!store.user && !store.platform) {
      if (multi && route.name === 'activate') { await renderFullscreen('./pages/activate.js', route.params); return; }
      if (route.name !== 'login') history.replaceState(null, '', '#/login');
      await renderFullscreen('./pages/login.js', {});
      return;
    }
    if (['login', 'setup', 'activate', ''].includes(route.name)) history.replaceState(null, '', `#/${defaultRoute()}`);

    const r2 = parseHash();
    let def = ROUTES[r2.name] || ROUTES[defaultRoute()];
    if (store.platform && !def.platform) { def = ROUTES.clients; history.replaceState(null, '', '#/clients'); }
    if (!store.platform && def.platform) { def = ROUTES.editor; history.replaceState(null, '', '#/editor'); }
    if (def.admin && store.user && store.user.role !== 'admin') { toast('Admin access required', 'warning'); def = ROUTES.editor; history.replaceState(null, '', '#/editor'); }
    const name = Object.keys(ROUTES).find(k => ROUTES[k] === def);

    if (navGuard && currentRoute && currentRoute !== name) {
      const ok = await navGuard();
      if (!ok) { history.replaceState(null, '', `#/${currentRoute}`); return; }
    }
    navGuard = null;

    if (!store.platform && !store.settings) await loadSettings();
    if (!shellEl) buildShell();
    markActive(name);
    setTopbar({ title: def.title, sub: def.sub });
    document.title = `${def.title} · ExportDesk`;

    if (currentCleanup) { try { currentCleanup(); } catch (e) { /* ignore */ } currentCleanup = null; }
    const mod = await import(def.module);
    const container = h('<div class="page-container"></div>');
    pageRoot.replaceChildren(container);
    currentRoute = name;
    window.scrollTo({ top: 0 });
    currentCleanup = await mod.render(container, { id: r2.id, ...r2.params }) || null;
    lastRenderedHash = location.hash;
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something went wrong', 'error');
  } finally {
    rendering = false;
    if (pendingRender) { pendingRender = false; if (location.hash !== lastRenderedHash) render(); }
  }
}

export async function refreshStatus() {
  store.status = await api.get('/api/setup/status');
  store.user = store.status.user || null;
  store.platform = store.status.platform || null;
  store.tenant = store.status.tenant || null;
  return store.status;
}

// ---------- Global events ----------
// A page that set location.hash and then called render() itself must not be rendered twice by the resulting hashchange
window.addEventListener('hashchange', () => { if (location.hash !== lastRenderedHash) render(); });
window.addEventListener('app:unauthenticated', () => { setToken(''); if (store.user || store.platform) { store.user = null; store.platform = null; shellEl = null; toast('Your session has expired. Please sign in again.', 'warning'); navigate('#/login'); render(); } });
window.addEventListener('app:db-missing', async () => { await refreshStatus(); shellEl = null; render(); });
document.addEventListener('keydown', e => {
  if ((!store.user && !store.platform) || !shellEl) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const map = store.platform ? { c: '#/clients' } : { n: '#/editor?new=1', i: '#/invoices', s: '#/settings', t: '#/team' };
  const target = map[e.key.toLowerCase()];
  if (target) { if (target === '#/team' && store.user.role !== 'admin') return; e.preventDefault(); navigate(target); }
});

// ---------- Boot ----------
(async () => {
  try {
    await refreshStatus();
  } catch (e) {
    document.getElementById('splash').innerHTML = `<div style="text-align:center;max-width:420px;padding:24px"><h2 style="margin-bottom:8px">Server not reachable</h2><p class="muted">The API at <code>${(window.XD_CONFIG && window.XD_CONFIG.apiBase) || location.origin}</code> did not respond. Start the backend (<code>npm start</code> / start.bat) or check the API URL in <code>js/config.js</code>, then reload.</p></div>`;
    return;
  }
  await render();
  const splash = document.getElementById('splash');
  splash.classList.add('hide');
  setTimeout(() => splash.remove(), 500);
})();

export { confirmDialog };
