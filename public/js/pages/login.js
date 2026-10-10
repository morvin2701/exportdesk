import { api } from '../api.js';
import { h, icon, esc, setBusy } from '../ui.js';
import { store, refreshStatus, render as renderApp } from '../app.js';

function artPanel() {
  return `<div class="auth-art">
    <div class="grid-lines"></div>
    <div class="auth-brand"><div class="sb-logo">${icon('logo')}</div><div>ExportDesk<div style="font-size:11px;font-weight:600;letter-spacing:.14em;color:#94a3b8;text-transform:uppercase">Export Invoicing Suite</div></div></div>
    <div class="auth-hero">
      <h2>Export invoices,<br><em>done in minutes.</em></h2>
      <p>Fill in the consignee, shipment and goods details. The invoice builds itself in real time with your logo, stamp and signature, ready to print or send as PDF.</p>
      <div class="auth-feats">
        <div class="auth-feat">${icon('sparkle')}<span>Live A4 preview while you type</span></div>
        <div class="auth-feat">${icon('ship')}<span>Incoterms, ports, HS codes & packing built in</span></div>
        <div class="auth-feat">${icon('db')}<span>Saved on your own SQL Server, offline</span></div>
        <div class="auth-feat">${icon('team')}<span>Team logins with admin & staff roles</span></div>
      </div>
    </div>
    <div class="auth-foot">Runs entirely on this PC · no cloud, no subscription</div>
    <div class="floating-doc">
      <div class="fd-title">COMMERCIAL INVOICE</div>
      <div class="fd-bar accent"></div><div class="fd-bar"></div><div class="fd-bar" style="width:70%"></div><div class="fd-bar" style="width:85%"></div><div class="fd-bar" style="width:55%"></div>
      <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:11px;font-weight:700"><span style="color:#64748b">GRAND TOTAL</span><span>$ 48,250.00</span></div>
    </div>
  </div>`;
}

export { artPanel };

export async function render(root) {
  document.title = 'Sign in · ExportDesk';
  const company = (store.status && store.status.db && store.status.db.database) || '';
  const el = h(`<div class="auth">
    ${artPanel()}
    <div class="auth-panel">
      <div class="auth-card">
        <h1>Welcome back</h1>
        <p class="lead">Sign in to continue to your invoices.</p>
        <form class="auth-form" novalidate>
          <div class="field"><label>Email</label><div class="input-group">${icon('user')}<input class="input" type="email" name="email" placeholder="you@company.com" autocomplete="username" required autofocus></div></div>
          <div class="field"><label>Password</label><div class="pw-wrap"><input class="input" type="password" name="password" placeholder="••••••••" autocomplete="current-password" required><button type="button" class="icon-btn" data-act="pw">${icon('eye')}</button></div></div>
          <div class="err"></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in ${icon('arrowRight')}</button>
          <p class="small muted" style="text-align:center">Forgot your password? Ask an administrator to reset it from the Team page.</p>
        </form>
        <p class="tiny muted" style="margin-top:28px;text-align:center">${icon('db', 'sm')} Database: <span class="mono">${esc(company)}</span></p>
      </div>
    </div>
  </div>`);
  root.appendChild(el);

  const form = el.querySelector('form');
  const err = el.querySelector('.err');
  el.querySelector('[data-act="pw"]').onclick = e => {
    const inp = form.password; inp.type = inp.type === 'password' ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eyeOff');
  };
  form.onsubmit = async e => {
    e.preventDefault();
    err.innerHTML = '';
    const btn = form.querySelector('[type="submit"]');
    setBusy(btn, true, 'Signing in…');
    try {
      await api.post('/api/auth/login', { email: form.email.value, password: form.password.value });
      await refreshStatus();
      location.hash = '#/editor';
      renderApp();
    } catch (ex) {
      err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span></div>`;
      setBusy(btn, false);
      form.password.focus(); form.password.select();
    }
  };
}
