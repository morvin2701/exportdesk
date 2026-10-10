import { api } from '../api.js';
import { h, icon, esc, setBusy } from '../ui.js';
import { store, refreshStatus, render as renderApp, isMulti } from '../app.js';

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
        <div class="auth-feat">${icon('db')}<span>Your data stays on your own SQL Server</span></div>
        <div class="auth-feat">${icon('team')}<span>Team logins with admin & staff roles</span></div>
      </div>
    </div>
    <div class="auth-foot">Your company's data is stored only in your own database</div>
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
  const multi = isMulti();
  const lockedTenant = String((window.XD_CONFIG && window.XD_CONFIG.tenant) || '').trim().toUpperCase();
  let savedCode = ''; try { savedCode = localStorage.getItem('xd_code') || ''; } catch (e) { /* ignore */ }
  const platformEnabled = !!(store.status && store.status.platformEnabled);
  let platformMode = false;

  const el = h(`<div class="auth">${artPanel()}<div class="auth-panel"><div class="auth-card"></div></div></div>`);
  root.appendChild(el);
  const card = el.querySelector('.auth-card');

  function draw() {
    const footer = multi ? (store.status.connected ? '' : `<div class="note warn" style="margin-bottom:16px">${icon('alert')}<span>The registry database on the server is not reachable right now. Sign-in may fail until it is back.</span></div>`) : '';
    card.innerHTML = platformMode ? `
      <h1>Platform owner</h1>
      <p class="lead">Manage client companies and their SQL Server connections.</p>
      ${footer}
      <form class="auth-form" novalidate>
        <div class="field"><label>Email</label><div class="input-group">${icon('shield')}<input class="input" type="email" name="email" placeholder="owner@yourcompany.com" autocomplete="username" required autofocus></div></div>
        <div class="field"><label>Password</label><div class="pw-wrap"><input class="input" type="password" name="password" placeholder="••••••••" autocomplete="current-password" required><button type="button" class="icon-btn" data-act="pw">${icon('eye')}</button></div></div>
        <div class="err"></div>
        <button class="btn btn-navy btn-lg btn-block" type="submit">Open Clients ${icon('arrowRight')}</button>
        <p class="small muted" style="text-align:center"><a href="#" data-act="toggle">← Back to company sign-in</a></p>
      </form>` : `
      <h1>Welcome back</h1>
      <p class="lead">Sign in to continue to your invoices.</p>
      ${footer}
      <form class="auth-form" novalidate>
        ${multi && !lockedTenant ? `<div class="field"><label>Company code</label><div class="input-group">${icon('building')}<input class="input mono" name="code" placeholder="ACME" value="${esc(savedCode)}" autocomplete="organization" style="text-transform:uppercase" required></div></div>` : ''}
        <div class="field"><label>Email</label><div class="input-group">${icon('user')}<input class="input" type="email" name="email" placeholder="you@company.com" autocomplete="username" required ${multi && !lockedTenant && !savedCode ? '' : 'autofocus'}></div></div>
        <div class="field"><label>Password</label><div class="pw-wrap"><input class="input" type="password" name="password" placeholder="••••••••" autocomplete="current-password" required><button type="button" class="icon-btn" data-act="pw">${icon('eye')}</button></div></div>
        <div class="err"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in ${icon('arrowRight')}</button>
        ${multi ? `<p class="small muted" style="text-align:center">New company? <a href="#/activate${lockedTenant ? '?code=' + encodeURIComponent(lockedTenant) : ''}">Set up your company with an activation key</a></p>` : '<p class="small muted" style="text-align:center">Forgot your password? Ask an administrator to reset it from the Team page.</p>'}
        ${multi && platformEnabled ? `<p class="tiny muted" style="text-align:center;margin-top:10px"><a href="#" data-act="toggle">Platform owner sign-in</a></p>` : ''}
      </form>
      ${!multi ? `<p class="tiny muted" style="margin-top:28px;text-align:center">${icon('db', 'sm')} Database: <span class="mono">${esc((store.status && store.status.db && store.status.db.database) || '')}</span></p>` : ''}`;

    const form = card.querySelector('form');
    const err = card.querySelector('.err');
    card.querySelector('[data-act="pw"]').onclick = e => { const inp = form.password; inp.type = inp.type === 'password' ? 'text' : 'password'; e.currentTarget.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eyeOff'); };
    const toggle = card.querySelector('[data-act="toggle"]'); if (toggle) toggle.onclick = e => { e.preventDefault(); platformMode = !platformMode; draw(); };
    form.onsubmit = async e => {
      e.preventDefault(); err.innerHTML = '';
      const btn = form.querySelector('[type="submit"]'); setBusy(btn, true, 'Signing in…');
      try {
        if (platformMode) {
          await api.post('/api/platform/login', { email: form.email.value, password: form.password.value });
        } else {
          const code = lockedTenant || (form.code ? form.code.value.trim().toUpperCase() : '');
          const r = await api.post('/api/auth/login', { email: form.email.value, password: form.password.value, code });
          if (multi) { try { localStorage.setItem('xd_code', code); } catch (ex) { /* ignore */ } }
          if (r.tenant) store.tenant = r.tenant;
        }
        await refreshStatus();
        location.hash = platformMode ? '#/clients' : '#/editor';
        renderApp();
      } catch (ex) {
        err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span>${ex.code === 'TENANT_NOT_SETUP' ? ` <a href="#/activate?code=${encodeURIComponent(form.code ? form.code.value.trim().toUpperCase() : lockedTenant)}">Set up now →</a>` : ''}</div>`;
        setBusy(btn, false);
        form.password.focus(); form.password.select();
      }
    };
  }
  draw();
}
