/** Client self-activation (multi mode): company code + activation key → connect their SQL Server → create their admin. */
import { api } from '../api.js';
import { h, icon, esc, setBusy, toast } from '../ui.js';
import { refreshStatus, render as renderApp } from '../app.js';
import { artPanel } from './login.js';
import { dbForm, wireDbForm } from './setup.js';

function steps(active) {
  const list = [['key', 'Company & key'], ['db', 'Your SQL Server'], ['admin', 'Admin account'], ['done', 'Ready']];
  const idx = list.findIndex(s => s[0] === active);
  return `<div class="steps">${list.map((s, i) => `<div class="step ${i === idx ? 'active' : ''} ${i < idx ? 'done' : ''}"><span class="n">${i < idx ? icon('check', 'sm') : i + 1}</span><span class="t">${esc(s[1])}</span></div>${i < list.length - 1 ? '<div class="step-line"></div>' : ''}`).join('')}</div>`;
}

export async function render(root, params) {
  document.title = 'Set up your company · ExportDesk';
  const el = h(`<div class="auth">${artPanel()}<div class="auth-panel"><div class="wizard"></div></div></div>`);
  root.appendChild(el);
  const wiz = el.querySelector('.wizard');
  const state = { code: String(params.code || '').toUpperCase(), key: String(params.key || '').toUpperCase(), info: null };

  function showKey() {
    wiz.innerHTML = `${steps('key')}<div class="wizard-card">
      <h2>Set up your company</h2>
      <p class="muted" style="margin-bottom:18px">Enter the company code and activation key you received from your provider.</p>
      <form class="auth-form" novalidate>
        <div class="field"><label>Company code</label><div class="input-group">${icon('building')}<input class="input mono" name="code" value="${esc(state.code)}" placeholder="ACME" style="text-transform:uppercase" required></div></div>
        <div class="field"><label>Activation key</label><div class="input-group">${icon('shield')}<input class="input mono" name="key" value="${esc(state.key)}" placeholder="XXXX-XXXX-XXXX" style="text-transform:uppercase" required></div></div>
        <div class="err"></div>
        <div class="btn-row between"><a class="btn btn-ghost" href="#/login">${icon('arrowLeft')} Sign in instead</a><button class="btn btn-primary" type="submit">Continue ${icon('arrowRight')}</button></div>
      </form></div>`;
    const form = wiz.querySelector('form'); const err = wiz.querySelector('.err');
    form.onsubmit = async e => {
      e.preventDefault(); err.innerHTML = '';
      state.code = form.code.value.trim().toUpperCase(); state.key = form.key.value.trim().toUpperCase();
      const btn = form.querySelector('[type="submit"]'); setBusy(btn, true, 'Checking…');
      try {
        const info = await api.post('/api/tenant/lookup', { code: state.code });
        // validate the key by calling test with no overrides only if DB already configured; otherwise the key is validated at the next step
        state.info = info;
        if (info.dbReady && info.hasUsers) { err.innerHTML = `<div class="form-ok">${icon('check')}<span><strong>${esc(info.name)}</strong> is already set up. <a href="#/login">Sign in →</a></span></div>`; setBusy(btn, false); return; }
        if (info.dbReady) showAdmin(); else showDb();
      } catch (ex) { err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span></div>`; setBusy(btn, false); }
    };
  }

  function showDb() {
    wiz.innerHTML = `${steps('db')}<div class="wizard-card">
      <h2>Connect your SQL Server</h2>
      <p class="muted" style="margin-bottom:6px">Company: <strong>${esc(state.info.name)}</strong> · code <span class="mono">${esc(state.code)}</span></p>
      <div class="note" style="margin-bottom:16px">${icon('info')}<span>Your invoices will be stored in <strong>your own</strong> SQL Server. Because the ExportDesk server connects to it over the internet, enter your <strong>public IP or DDNS hostname and port</strong> (e.g. <code>103.1.2.3,1433</code>), not the Windows computer name.</span></div>
      ${dbForm({ database: `ExportDesk_${state.code.replace(/[^A-Z0-9_]/g, '_')}` }, { compact: true, remote: true })}
    </div>`;
    wireDbForm(wiz.querySelector('form'), {
      testUrl: '/api/tenant/activate/test', installUrl: '/api/tenant/activate/install',
      extra: () => ({ code: state.code, key: state.key }),
      onInstalled: async () => showAdmin(),
    });
  }

  function showAdmin() {
    wiz.innerHTML = `${steps('admin')}<div class="wizard-card">
      <h2>Create your admin account</h2>
      <p class="muted" style="margin-bottom:18px">This is the first user for <strong>${esc(state.info.name)}</strong>. Admins manage settings and the team.</p>
      <form class="auth-form" novalidate>
        <div class="form-grid">
          <div class="field"><label>Your name</label><input class="input" name="name" placeholder="Full name" required></div>
          <div class="field"><label>Email</label><input class="input" type="email" name="email" placeholder="you@company.com" required></div>
          <div class="field"><label>Password</label><input class="input" type="password" name="password" placeholder="Min. 6 characters" required></div>
          <div class="field"><label>Confirm password</label><input class="input" type="password" name="confirm" placeholder="Repeat password" required></div>
        </div>
        <div class="err"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Create account & open ExportDesk ${icon('arrowRight')}</button>
      </form></div>`;
    const form = wiz.querySelector('form'); const err = wiz.querySelector('.err');
    form.onsubmit = async e => {
      e.preventDefault(); err.innerHTML = '';
      if (form.password.value !== form.confirm.value) { err.innerHTML = `<div class="form-error">${icon('alert')}<span>Passwords do not match</span></div>`; return; }
      const btn = form.querySelector('[type="submit"]'); setBusy(btn, true, 'Creating…');
      try {
        await api.post('/api/tenant/activate/admin', { code: state.code, key: state.key, name: form.name.value, email: form.email.value, password: form.password.value });
        try { localStorage.setItem('xd_code', state.code); } catch (ex) { /* ignore */ }
        await refreshStatus();
        wiz.innerHTML = `${steps('done')}<div class="wizard-card" style="text-align:center"><div class="sb-logo" style="margin:0 auto 16px;width:64px;height:64px;border-radius:18px">${icon('check', 'xl')}</div><h2>You're all set</h2><p class="muted">Add your logo, stamp, signature and bank details in Settings, then create your first invoice.</p><div class="btn-row" style="justify-content:center;margin-top:20px"><button class="btn btn-secondary" data-go="#/settings">${icon('settings')} Go to Settings</button><button class="btn btn-primary" data-go="#/editor">${icon('plus')} Create first invoice</button></div></div>`;
        wiz.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; renderApp(); });
      } catch (ex) { err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span></div>`; setBusy(btn, false); }
    };
  }

  showKey();
}
