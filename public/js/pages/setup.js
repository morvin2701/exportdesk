/** First-run wizard: connect to the local SQL Server instance → create admin. */
import { api } from '../api.js';
import { h, icon, esc, setBusy, toast } from '../ui.js';
import { store, refreshStatus, render as renderApp } from '../app.js';
import { artPanel } from './login.js';

function steps(active) {
  const list = [['db', 'Connect SQL Server'], ['admin', 'Admin account'], ['done', 'Ready']];
  const idx = list.findIndex(s => s[0] === active);
  return `<div class="steps">${list.map((s, i) => `<div class="step ${i === idx ? 'active' : ''} ${i < idx ? 'done' : ''}"><span class="n">${i < idx ? icon('check', 'sm') : i + 1}</span><span class="t">${esc(s[1])}</span></div>${i < list.length - 1 ? '<div class="step-line"></div>' : ''}`).join('')}</div>`;
}

export function dbForm(existing = {}, { compact = false } = {}) {
  const ex = existing || {};
  return `<form class="db-form" novalidate>
    <div class="form-grid">
      <div class="field span-2">
        <label>Server / instance name</label>
        <div class="input-group">${icon('db')}<input class="input mono" name="server" placeholder="DESKTOP-PC\\SQLEXPRESS" value="${esc(ex.server || '')}" autocomplete="off" spellcheck="false"></div>
        <div class="hint">Exactly as you type it in SSMS "Connect to Server". Examples: <code>.\\SQLEXPRESS</code>, <code>MYPC\\SQLEXPRESS</code>, <code>localhost</code>, <code>192.168.1.10,1433</code></div>
      </div>
      <div class="field span-2">
        <label>Authentication</label>
        <div class="seg auth-seg">
          <button type="button" data-auth="sql" class="${(ex.authType || 'sql') === 'sql' ? 'active' : ''}">SQL Server Authentication</button>
          <button type="button" data-auth="windows" class="${ex.authType === 'windows' ? 'active' : ''}">Windows Authentication</button>
        </div>
        <input type="hidden" name="authType" value="${esc(ex.authType || 'sql')}">
      </div>
      <div class="field domain-field ${ex.authType === 'windows' ? '' : 'hidden'} span-2"><label>Windows domain / computer name</label><input class="input mono" name="domain" placeholder="DESKTOP-PC" value="${esc(ex.domain || '')}"><div class="hint">For a local Windows account use the PC name. Leave blank if unsure.</div></div>
      <div class="field"><label>Username</label><input class="input mono" name="user" placeholder="sa" value="${esc(ex.user || '')}" autocomplete="off"></div>
      <div class="field"><label>Password</label><div class="pw-wrap"><input class="input" type="password" name="password" placeholder="••••••••" autocomplete="new-password"><button type="button" class="icon-btn" data-act="pw">${icon('eye')}</button></div></div>
      <div class="field"><label>Database name</label><input class="input mono" name="database" placeholder="ExportDesk" value="${esc(ex.database || 'ExportDesk')}"><div class="hint">Created automatically if it doesn't exist.</div></div>
      <div class="field"><label>Port (optional)</label><input class="input mono" name="port" placeholder="1433" value="${esc(ex.port || '')}"><div class="hint">Leave blank when using an instance name.</div></div>
      <div class="field span-2"><label class="switch"><input type="checkbox" name="encrypt" ${ex.encrypt === false ? '' : 'checked'}><span class="track"></span><span>Encrypt connection (recommended — self-signed certificates are accepted; falls back automatically if the server can\'t)</span></label></div>
    </div>
    <div class="result" style="margin-top:14px"></div>
    <div class="btn-row between" style="margin-top:18px">
      <button type="button" class="btn btn-secondary" data-act="test">${icon('refresh')} Test connection</button>
      <button type="submit" class="btn btn-primary">${icon('check')} ${compact ? 'Save & connect' : 'Create database & continue'}</button>
    </div>
    ${compact ? '' : `<details style="margin-top:18px"><summary class="small strong" style="cursor:pointer;color:var(--primary)">Can't connect? Checklist for SQL Server on this PC</summary>
      <ol class="help-list" style="margin-top:10px">
        <li>Open <strong>SQL Server Configuration Manager</strong> → SQL Server Network Configuration → Protocols for your instance → enable <code>TCP/IP</code>, then restart the SQL Server service.</li>
        <li>For a named instance (e.g. <code>\\SQLEXPRESS</code>) start the <strong>SQL Server Browser</strong> service (Services → set to Automatic).</li>
        <li>For SQL login: in SSMS right-click the server → Properties → Security → select <strong>SQL Server and Windows Authentication mode</strong>, then restart the service.</li>
        <li>Enable the login: SSMS → Security → Logins → <code>sa</code> → Properties → Status → Login: Enabled, and set a password under General.</li>
        <li>Windows Firewall: allow port <code>1433</code> (TCP) and <code>1434</code> (UDP) if other PCs need to connect.</li>
      </ol></details>`}
  </form>`;
}

export function wireDbForm(form, { onInstalled }) {
  const result = form.querySelector('.result');
  form.querySelector('[data-act="pw"]').onclick = e => { const i = form.password; i.type = i.type === 'password' ? 'text' : 'password'; e.currentTarget.innerHTML = icon(i.type === 'password' ? 'eye' : 'eyeOff'); };
  form.querySelectorAll('.auth-seg button').forEach(b => b.onclick = () => {
    form.querySelectorAll('.auth-seg button').forEach(x => x.classList.toggle('active', x === b));
    form.authType.value = b.dataset.auth;
    form.querySelector('.domain-field').classList.toggle('hidden', b.dataset.auth !== 'windows');
  });
  const payload = () => ({
    server: form.server.value.trim(), authType: form.authType.value, domain: form.domain.value.trim(),
    user: form.user.value.trim(), password: form.password.value, database: form.database.value.trim(),
    port: form.port.value.trim(), encrypt: form.encrypt.checked,
  });
  form.querySelector('[data-act="test"]').onclick = async e => {
    const btn = e.currentTarget; setBusy(btn, true, 'Testing…'); result.innerHTML = '';
    try {
      const r = await api.post('/api/setup/test', payload());
      result.innerHTML = `<div class="conn-result"><div class="cr-title">${icon('check')} Connected to ${esc(r.serverName || '')} · SQL Server ${esc(r.version)} (${esc(r.edition)})</div>
        ${r.databases.length ? `<div>Existing databases (click to use):</div><div class="cr-dbs">${r.databases.map(d => `<span data-db="${esc(d)}">${esc(d)}</span>`).join('')}</div>` : '<div>No user databases yet — a new one will be created.</div>'}</div>`;
      result.querySelectorAll('[data-db]').forEach(s => s.onclick = () => { form.database.value = s.dataset.db; });
    } catch (ex) {
      result.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span></div>`;
    } finally { setBusy(btn, false); }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]'); setBusy(btn, true, 'Setting up database…'); result.innerHTML = '';
    try {
      const r = await api.post('/api/setup/install', payload());
      toast(`Database "${r.database}" is ready`, 'success');
      await onInstalled(r);
    } catch (ex) {
      result.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span></div>`;
    } finally { setBusy(btn, false); }
  };
}

export async function render(root, params) {
  document.title = 'Setup · ExportDesk';
  const step = params.step || 'db';
  const el = h(`<div class="auth">${artPanel()}<div class="auth-panel"><div class="wizard"></div></div></div>`);
  root.appendChild(el);
  const wiz = el.querySelector('.wizard');

  function showDb() {
    const cfg = (store.status && store.status.db) || {};
    const notConnected = store.status && store.status.configured && !store.status.connected;
    wiz.innerHTML = `${steps('db')}<div class="wizard-card">
      <h2>Connect to SQL Server</h2>
      <p class="muted" style="margin-bottom:18px">Enter the instance you created in SSMS. ExportDesk will create the database and tables for you and remember this connection on this PC.</p>
      ${notConnected ? `<div class="note warn" style="margin-bottom:16px">${icon('alert')}<span>Saved connection to <strong>${esc(cfg.server || '')}</strong> is not responding. Make sure SQL Server is running, or update the details below.</span></div>` : ''}
      ${dbForm(cfg)}
    </div>`;
    wireDbForm(wiz.querySelector('form'), { onInstalled: async () => { await refreshStatus(); if (store.status.hasUsers) { location.hash = '#/login'; renderApp(); } else showAdmin(); } });
  }

  function showAdmin() {
    wiz.innerHTML = `${steps('admin')}<div class="wizard-card">
      <h2>Create your admin account</h2>
      <p class="muted" style="margin-bottom:18px">This is the first user. Admins manage settings, the team and the database connection.</p>
      <form class="auth-form" novalidate>
        <div class="field"><label>Company name</label><div class="input-group">${icon('building')}<input class="input" name="company" placeholder="Your Exports Pvt. Ltd." required></div></div>
        <div class="form-grid">
          <div class="field"><label>Your name</label><input class="input" name="name" placeholder="Full name" required></div>
          <div class="field"><label>Email</label><input class="input" type="email" name="email" placeholder="you@company.com" required></div>
          <div class="field"><label>Password</label><input class="input" type="password" name="password" placeholder="Min. 6 characters" required></div>
          <div class="field"><label>Confirm password</label><input class="input" type="password" name="confirm" placeholder="Repeat password" required></div>
        </div>
        <div class="err"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Create account & open ExportDesk ${icon('arrowRight')}</button>
      </form>
    </div>`;
    const form = wiz.querySelector('form'); const err = wiz.querySelector('.err');
    form.onsubmit = async e => {
      e.preventDefault(); err.innerHTML = '';
      if (form.password.value !== form.confirm.value) { err.innerHTML = `<div class="form-error">${icon('alert')}<span>Passwords do not match</span></div>`; return; }
      const btn = form.querySelector('[type="submit"]'); setBusy(btn, true, 'Creating…');
      try {
        await api.post('/api/setup/admin', { name: form.name.value, email: form.email.value, password: form.password.value, company: form.company.value });
        await refreshStatus();
        wiz.innerHTML = `${steps('done')}<div class="wizard-card" style="text-align:center"><div class="sb-logo" style="margin:0 auto 16px;width:64px;height:64px;border-radius:18px">${icon('check', 'xl')}</div><h2>You're all set</h2><p class="muted">Add your logo, stamp, signature and bank details in Settings, then create your first invoice.</p><div class="btn-row" style="justify-content:center;margin-top:20px"><button class="btn btn-secondary" data-go="#/settings">${icon('settings')} Go to Settings</button><button class="btn btn-primary" data-go="#/editor">${icon('plus')} Create first invoice</button></div></div>`;
        wiz.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; renderApp(); });
      } catch (ex) {
        err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span></div>`;
        setBusy(btn, false);
      }
    };
  }

  if (step === 'admin') showAdmin(); else showDb();
}
