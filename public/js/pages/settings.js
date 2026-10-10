/** Settings: company, branding, numbering, defaults, banks, terms, database, profile. */
import { api } from '../api.js';
import { h, icon, esc, toast, openModal, confirmDialog, setBusy, readFileAsDataURL } from '../ui.js';
import { store, loadSettings, refreshStatus, isMulti } from '../app.js';
import { renderInvoice } from '../document.js';
import { dbForm, wireDbForm } from './setup.js';
import { CURRENCIES, COUNTRIES, INCOTERMS, INCOTERM_LABELS, TRANSPORT_MODES, UNITS, uid } from '../utils.js';

const TABS = [
  ['company', 'Company', 'building'], ['branding', 'Branding', 'image'], ['numbering', 'Numbering', 'hash'], ['defaults', 'Defaults', 'sliders'],
  ['banks', 'Bank accounts', 'bank'], ['terms', 'Terms', 'list'], ['database', 'Database', 'db'], ['profile', 'My profile', 'user'],
];
const ACCENTS = ['#0f766e', '#0b1b3a', '#1d4ed8', '#7c3aed', '#b91c1c', '#c2410c', '#b45309', '#15803d', '#0e7490', '#be185d', '#334155', '#000000'];
const opt = (list, val, lf) => list.map(v => { const value = typeof v === 'object' ? v.value : v; const label = lf ? lf(v) : (typeof v === 'object' ? v.label : v); return `<option value="${esc(value)}" ${String(value) === String(val) ? 'selected' : ''}>${esc(label)}</option>`; }).join('');

export async function render(root, params) {
  const isAdmin = store.user.role === 'admin';
  let settings = await loadSettings(true);
  let tab = params.tab || (isAdmin ? 'company' : 'profile');
  let brandingDirty = false;

  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Settings</h1><p class="lead">${isAdmin ? 'Everything that appears on your invoices lives here.' : 'Only administrators can change company settings. You can update your own profile.'}</p></div></div>
    <div class="settings-layout">
      <div class="card card-pad vtabs" style="padding:10px">${TABS.filter(t => isAdmin || t[0] === 'profile').map(t => `<button class="tab ${t[0] === tab ? 'active' : ''}" data-tab="${t[0]}">${icon(t[2])} ${t[1]}</button>`).join('')}</div>
      <div class="card tab-panel"></div>
    </div>
  </div><datalist id="dl-countries">${COUNTRIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;

  const panel = root.querySelector('.tab-panel');
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; root.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b)); show(); });

  async function saveKeys(keys, btn) {
    setBusy(btn, true, 'Saving…');
    try {
      const payload = {}; keys.forEach(k => payload[k] = settings[k]);
      await api.put('/api/settings', payload);
      settings = await loadSettings(true);
      brandingDirty = false;
      toast('Settings saved', 'success');
      if (tab === 'branding') show();
      const brand = document.querySelector('.sb-brand-name'); if (brand && settings.company.name) brand.textContent = settings.company.name;
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(btn, false); }
  }

  function bindForm(form, key) {
    form.addEventListener('input', e => {
      const el = e.target; const f = el.dataset.f; if (!f) return;
      settings[key][f] = el.type === 'checkbox' ? el.checked : (el.dataset.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value);
      form.dispatchEvent(new CustomEvent('settings:change', { bubbles: false }));
    });
  }

  function saveBar(keys, extra = '') {
    return `<div class="card-head" style="border-top:1px solid var(--border);border-bottom:0;background:var(--surface-2);border-radius:0 0 16px 16px"><span class="small muted">${extra}</span><button class="btn btn-primary" data-save="${keys.join(',')}">${icon('check')} Save changes</button></div>`;
  }
  function wireSave(host) { host.querySelectorAll('[data-save]').forEach(b => b.onclick = () => saveKeys(b.dataset.save.split(','), b)); }

  function show() {
    const c = settings.company, b = settings.branding, n = settings.numbering, d = settings.defaults;
    if (tab === 'company') {
      panel.innerHTML = `<div class="card-head"><h3>${icon('building')} Company profile</h3></div><div class="card-body"><form class="form-grid" onsubmit="return false">
        <div class="field"><label>Company name</label><input class="input" data-f="name" value="${esc(c.name)}" placeholder="Shown as the exporter"></div>
        <div class="field"><label>Tagline</label><input class="input" data-f="tagline" value="${esc(c.tagline)}" placeholder="e.g. Exporters of fine spices"></div>
        <div class="field span-2"><label>Legal name (if different)</label><input class="input" data-f="legalName" value="${esc(c.legalName)}"></div>
        <div class="field span-2"><label>Address</label><textarea class="textarea" data-f="address" rows="2">${esc(c.address)}</textarea></div>
        <div class="field"><label>City</label><input class="input" data-f="city" value="${esc(c.city)}"></div>
        <div class="field"><label>Country</label><input class="input" data-f="country" list="dl-countries" value="${esc(c.country)}"></div>
        <div class="field"><label>Phone</label><input class="input" data-f="phone" value="${esc(c.phone)}"></div>
        <div class="field"><label>Alternate phone</label><input class="input" data-f="altPhone" value="${esc(c.altPhone)}"></div>
        <div class="field"><label>Email</label><input class="input" type="email" data-f="email" value="${esc(c.email)}"></div>
        <div class="field"><label>Website</label><input class="input" data-f="website" value="${esc(c.website)}"></div>
        <div class="divider span-2" style="margin:4px 0"></div>
        <div class="field"><label>IEC / Exporter code</label><input class="input mono" data-f="iec" value="${esc(c.iec)}"></div>
        <div class="field"><label>Tax ID label</label><input class="input" data-f="taxLabel" value="${esc(c.taxLabel || 'TRN / GSTIN')}" placeholder="GSTIN / TRN / VAT"></div>
        <div class="field"><label>Tax ID (GSTIN / TRN / VAT)</label><input class="input mono" data-f="taxId" value="${esc(c.taxId)}"></div>
        <div class="field"><label>PAN</label><input class="input mono" data-f="pan" value="${esc(c.pan)}"></div>
        <div class="field span-2"><label>Registration / License No.</label><input class="input mono" data-f="regNo" value="${esc(c.regNo)}"></div>
      </form></div>${saveBar(['company'])}`;
      bindForm(panel.querySelector('form'), 'company'); wireSave(panel);
    }

    if (tab === 'branding') {
      const tile = (key, label, hint, checker) => `<div class="field"><label>${label}</label><div class="upload-tile ${checker ? 'checker' : ''}" data-img="${key}">${b[key] ? `<img src="${b[key]}" alt=""><button class="icon-btn sm danger ut-remove" data-remove="${key}" title="Remove">${icon('x')}</button>` : `${icon('upload')}<div class="ut-label">Click or drop image<br><span class="tiny">PNG / JPG / SVG · max 2MB</span></div>`}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></div><div class="hint">${hint}</div></div>`;
      panel.innerHTML = `<div class="card-head"><h3>${icon('image')} Branding</h3></div><div class="card-body">
        <div class="form-grid cols-3">
          ${tile('logo', 'Company logo', 'Appears top-left on every invoice.')}
          ${tile('stamp', 'Company stamp / seal', 'Use a PNG with transparent background for best results.', true)}
          ${tile('signature', 'Authorised signature', 'Transparent PNG recommended. Shown above the signatory name.', true)}
        </div>
        <div class="form-grid" style="margin-top:18px">
          <div class="field"><label>Signatory name</label><input class="input" data-f="signatoryName" value="${esc(b.signatoryName)}" placeholder="e.g. Rahul Mehta"></div>
          <div class="field"><label>Signatory title</label><input class="input" data-f="signatoryTitle" value="${esc(b.signatoryTitle)}" placeholder="Authorised Signatory"></div>
          <div class="field"><label>Default template</label><select class="select" data-f="template">${opt([{ value: 'modern', label: 'Modern — accent bands, rounded cards' }, { value: 'classic', label: 'Classic — ruled, traditional' }, { value: 'minimal', label: 'Minimal — airy and typographic' }], b.template)}</select></div>
          <div class="field"><label>Accent colour</label><div class="btn-row" style="gap:6px;flex-wrap:wrap">${ACCENTS.map(a => `<button type="button" class="swatch" data-accent="${a}" title="${a}" style="width:28px;height:28px;border-radius:8px;background:${a};border:2px solid ${b.accent === a ? 'var(--text)' : 'transparent'};cursor:pointer;box-shadow:var(--shadow-sm)"></button>`).join('')}<input type="color" data-f="accent" value="${esc(b.accent)}" style="width:40px;height:28px;border:0;background:none;cursor:pointer;padding:0"></div></div>
        </div>
        <div class="divider"></div>
        <div class="label" style="margin-bottom:10px">Live preview</div>
        <div style="background:var(--bg-2);border-radius:12px;padding:16px;overflow:hidden"><div class="brand-preview" style="transform-origin:top left;width:210mm"></div></div>
      </div>${saveBar(['branding'], brandingDirty ? '<span class="dirty-pill">UNSAVED CHANGES</span>' : 'Images are stored in the database and printed on every invoice.')}`;
      const form = panel.querySelector('.card-body');
      bindForm(form, 'branding');
      form.addEventListener('settings:change', () => { if (!brandingDirty) { brandingDirty = true; const sp = panel.querySelector('.card-head:last-child .small'); if (sp) sp.innerHTML = '<span class="dirty-pill">UNSAVED CHANGES</span>'; } });
      const preview = () => {
        const host = panel.querySelector('.brand-preview');
        host.innerHTML = renderInvoice(sampleDoc(settings), settings);
        const w = host.parentElement.clientWidth - 32; const s = Math.min(1, w / 794);
        host.style.transform = `scale(${s})`; host.style.height = `${host.querySelector('.doc').offsetHeight * s}px`;
      };
      form.addEventListener('settings:change', preview);
      panel.querySelectorAll('.swatch').forEach(s => s.onclick = () => { settings.branding.accent = s.dataset.accent; panel.querySelector('[data-f="accent"]').value = s.dataset.accent; panel.querySelectorAll('.swatch').forEach(x => x.style.borderColor = x === s ? 'var(--text)' : 'transparent'); preview(); });
      panel.querySelectorAll('.upload-tile').forEach(t => {
        const key = t.dataset.img; const input = t.querySelector('input');
        t.onclick = e => { if (e.target.closest('[data-remove]')) return; input.click(); };
        const handle = async file => { try { settings.branding[key] = await readFileAsDataURL(file); brandingDirty = true; show(); } catch (ex) { toast(ex.message, 'error'); } };
        input.onchange = () => handle(input.files[0]);
        t.ondragover = e => { e.preventDefault(); t.classList.add('drag'); }; t.ondragleave = () => t.classList.remove('drag');
        t.ondrop = e => { e.preventDefault(); t.classList.remove('drag'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); };
        const rm = t.querySelector('[data-remove]'); if (rm) rm.onclick = e => { e.stopPropagation(); settings.branding[key] = ''; brandingDirty = true; show(); };
      });
      wireSave(panel); setTimeout(preview, 20);
    }

    if (tab === 'numbering') {
      const sample = () => `${(n.prefix || 'INV').trim()}${n.yearInNumber === false ? '' : '-' + new Date().getFullYear()}-${String(Number(n.startFrom) || 1).padStart(Number(n.padding) || 4, '0')}`;
      panel.innerHTML = `<div class="card-head"><h3>${icon('hash')} Invoice numbering</h3></div><div class="card-body"><form class="form-grid" onsubmit="return false">
        <div class="field"><label>Prefix</label><input class="input mono" data-f="prefix" value="${esc(n.prefix)}" placeholder="EXP-INV"></div>
        <div class="field"><label>Digits</label><select class="select" data-f="padding" data-type="number">${opt([3, 4, 5, 6], n.padding)}</select></div>
        <div class="field"><label>Start from</label><input class="input mono" type="number" min="1" data-f="startFrom" data-type="number" value="${esc(n.startFrom)}"><div class="hint">Used when no invoice exists yet for the sequence.</div></div>
        <div class="field"><label>&nbsp;</label><label class="switch"><input type="checkbox" data-f="yearInNumber" ${n.yearInNumber !== false ? 'checked' : ''}><span class="track"></span><span>Include year (sequence resets every year)</span></label></div>
        <div class="field span-2"><div class="note">${icon('info')}<span>Next invoice will look like <strong class="mono num-sample">${esc(sample())}</strong>. You can always type a custom number in the editor.</span></div></div>
      </form></div>${saveBar(['numbering'])}`;
      const form = panel.querySelector('form'); bindForm(form, 'numbering');
      form.addEventListener('settings:change', () => panel.querySelector('.num-sample').textContent = sample());
      wireSave(panel);
    }

    if (tab === 'defaults') {
      panel.innerHTML = `<div class="card-head"><h3>${icon('sliders')} Defaults for new invoices</h3></div><div class="card-body"><form class="form-grid" onsubmit="return false">
        <div class="field"><label>Currency</label><select class="select" data-f="currency">${opt(CURRENCIES.map(x => ({ value: x.code, label: `${x.code} — ${x.name}` })), d.currency)}</select></div>
        <div class="field"><label>Due in (days)</label><input class="input" type="number" min="0" data-f="dueDays" data-type="number" value="${esc(d.dueDays)}"></div>
        <div class="field"><label>Incoterm</label><select class="select" data-f="incoterm">${opt(INCOTERMS, d.incoterm, v => `${v} — ${INCOTERM_LABELS[v]}`)}</select></div>
        <div class="field"><label>Mode of transport</label><select class="select" data-f="transportMode">${opt(TRANSPORT_MODES, d.transportMode)}</select></div>
        <div class="field span-2"><label>Payment terms</label><input class="input" data-f="paymentTerms" value="${esc(d.paymentTerms)}"></div>
        <div class="field"><label>Country of origin</label><input class="input" data-f="countryOfOrigin" list="dl-countries" value="${esc(d.countryOfOrigin)}"></div>
        <div class="field"><label>Port of loading</label><input class="input" data-f="portOfLoading" value="${esc(d.portOfLoading)}"></div>
        <div class="field"><label>Default unit</label><select class="select" data-f="unit">${opt(UNITS, d.unit)}</select></div>
        <div class="field"><label>Tax label &amp; rate</label><div style="display:grid;grid-template-columns:1fr 90px;gap:8px"><input class="input" data-f="taxLabel" value="${esc(d.taxLabel)}" placeholder="VAT"><input class="input r" type="number" min="0" step="0.01" data-f="taxRate" data-type="number" value="${esc(d.taxRate)}" placeholder="%"></div></div>
        <div class="field span-2"><label>Declaration</label><textarea class="textarea" data-f="declaration" rows="2">${esc(d.declaration)}</textarea></div>
        <div class="field span-2"><label>Default notes</label><textarea class="textarea" data-f="notes" rows="2" style="min-height:60px">${esc(d.notes)}</textarea></div>
      </form></div>${saveBar(['defaults'])}`;
      bindForm(panel.querySelector('form'), 'defaults'); wireSave(panel);
    }

    if (tab === 'banks') {
      const banks = settings.banks;
      panel.innerHTML = `<div class="card-head"><h3>${icon('bank')} Bank accounts</h3><button class="btn btn-secondary btn-sm" data-act="add">${icon('plus')} Add account</button></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
        ${banks.length ? banks.map((bk, i) => `<div class="card card-pad hover" style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><div class="strong">${esc(bk.label || bk.bankName)} ${i === 0 ? '<span class="badge badge-paid" style="margin-left:6px">Default</span>' : ''}</div><div class="small muted">${esc(bk.bankName)} · ${esc(bk.accountNo || bk.iban || '')} · ${esc(bk.swift || '')} ${bk.currency ? '· ' + esc(bk.currency) : ''}</div></div><div class="btn-row"><button class="icon-btn" data-edit="${i}" title="Edit">${icon('edit')}</button><button class="icon-btn danger" data-del="${i}" title="Remove">${icon('trash')}</button></div></div>`).join('')
          : `<div class="empty-state">${icon('bank')}<h4>No bank accounts</h4><p>Add the account where buyers should remit payment. It prints on the invoice.</p></div>`}
        </div>${saveBar(['banks'], 'The first account is used by default on new invoices.')}`;
      panel.querySelector('[data-act="add"]').onclick = () => bankModal(null, bk => { settings.banks.push(bk); show(); });
      panel.querySelectorAll('[data-edit]').forEach(x => x.onclick = () => bankModal(banks[Number(x.dataset.edit)], bk => { settings.banks[Number(x.dataset.edit)] = bk; show(); }));
      panel.querySelectorAll('[data-del]').forEach(x => x.onclick = async () => { if (await confirmDialog({ title: 'Remove this bank account?', message: 'Existing invoices keep their saved details.', confirmText: 'Remove', danger: true })) { settings.banks.splice(Number(x.dataset.del), 1); show(); } });
      wireSave(panel);
    }

    if (tab === 'terms') {
      panel.innerHTML = `<div class="card-head"><h3>${icon('list')} Default terms & conditions</h3></div><div class="card-body"><div class="field"><label>One term per line</label><textarea class="textarea" rows="8" data-terms>${esc((settings.terms.lines || []).join('\n'))}</textarea><div class="hint">These are pre-filled on every new invoice and can be edited per invoice.</div></div></div>${saveBar(['terms'])}`;
      panel.querySelector('[data-terms]').oninput = e => { settings.terms.lines = e.target.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean); };
      wireSave(panel);
    }

    if (tab === 'database' && isMulti()) {
      const t = store.tenant || {};
      panel.innerHTML = `<div class="card-head"><h3>${icon('db')} Your SQL Server</h3><span class="tb-status"><span class="dot"></span>Connected</span></div>
        <div class="card-body">
          <div class="form-grid" style="margin-bottom:18px">
            <div class="chip">${icon('building', 'sm')} Company: <span class="mono">${esc(t.name || '')} (${esc(t.code || '')})</span></div>
            <div class="chip">${icon('db', 'sm')} Server: <span class="mono">${esc(t.db_server || '—')}</span></div>
            <div class="chip">${icon('saved', 'sm')} Database: <span class="mono">${esc(t.db_database || '—')}</span></div>
          </div>
          <div class="note">${icon('info')}<span>All your invoices, settings and users are stored in this database on <strong>your own</strong> SQL Server. To change the connection (new PC, new IP, new password) contact your provider — they update it from their Clients page.</span></div>
        </div>`;
    }

    if (tab === 'database' && !isMulti()) {
      const cfg = (store.status && store.status.db) || {};
      panel.innerHTML = `<div class="card-head"><h3>${icon('db')} SQL Server connection</h3><span class="tb-status"><span class="dot ${store.status.connected ? '' : 'off'}"></span>${store.status.connected ? 'Connected' : 'Not connected'}</span></div>
        <div class="card-body">
          <div class="form-grid" style="margin-bottom:18px">
            <div class="chip">${icon('db', 'sm')} Server: <span class="mono">${esc(cfg.server || '—')}</span></div>
            <div class="chip">${icon('saved', 'sm')} Database: <span class="mono">${esc(cfg.database || '—')}</span></div>
            <div class="chip">${icon('user', 'sm')} Login: <span class="mono">${esc(cfg.authType === 'windows' ? (cfg.domain ? cfg.domain + '\\' : '') + cfg.user + ' (Windows)' : cfg.user || '—')}</span></div>
            <div class="chip">${icon('shield', 'sm')} Encrypt: <span class="mono">${cfg.encrypt ? 'yes' : 'no'}</span></div>
          </div>
          <div class="note warn" style="margin-bottom:16px">${icon('alert')}<span>Changing the connection points ExportDesk at a different database. Existing data stays in the old database; a new empty database will be created if the name doesn't exist. Re-enter the password to save.</span></div>
          ${dbForm(cfg, { compact: true })}
        </div>`;
      wireDbForm(panel.querySelector('form'), { onInstalled: async () => { await refreshStatus(); settings = await loadSettings(true); show(); } });
    }

    if (tab === 'profile') {
      panel.innerHTML = `<div class="card-head"><h3>${icon('user')} My profile</h3></div><div class="card-body"><form class="form-grid" novalidate>
        <div class="field"><label>Name</label><input class="input" name="name" value="${esc(store.user.name)}"></div>
        <div class="field"><label>Email</label><input class="input" value="${esc(store.user.email)}" disabled><div class="hint">Ask an admin to change your email.</div></div>
        <div class="field span-2"><div class="label" style="margin-top:6px">Change password</div></div>
        <div class="field"><label>Current password</label><input class="input" type="password" name="currentPassword" autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input class="input" type="password" name="newPassword" autocomplete="new-password" placeholder="Min. 6 characters"></div>
        <div class="field span-2 err"></div>
        <div class="field span-2 btn-row right"><button class="btn btn-primary" type="submit">${icon('check')} Save profile</button></div>
      </form></div>`;
      const form = panel.querySelector('form');
      form.onsubmit = async e => {
        e.preventDefault(); const btn = form.querySelector('[type="submit"]'); setBusy(btn, true, 'Saving…'); form.querySelector('.err').innerHTML = '';
        try {
          const r = await api.put('/api/auth/profile', { name: form.name.value, currentPassword: form.currentPassword.value, newPassword: form.newPassword.value });
          store.user = { ...store.user, ...r.user }; const nm = document.querySelector('.sb-user-name'); if (nm) nm.textContent = store.user.name;
          form.currentPassword.value = ''; form.newPassword.value = ''; toast('Profile updated', 'success');
        } catch (ex) { form.querySelector('.err').innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(ex.message)}</span></div>`; }
        finally { setBusy(btn, false); }
      };
    }
  }

  function bankModal(bank, onDone) {
    const bk = bank || { id: uid(), label: '', beneficiary: settings.company.name || '', bankName: '', branch: '', accountNo: '', iban: '', swift: '', ifsc: '', currency: settings.defaults.currency || 'USD', intermediary: '' };
    const body = h(`<form class="form-grid" novalidate>
      <div class="field"><label>Label</label><input class="input" name="label" value="${esc(bk.label)}" placeholder="e.g. USD account"></div>
      <div class="field"><label>Beneficiary name</label><input class="input" name="beneficiary" value="${esc(bk.beneficiary)}"></div>
      <div class="field"><label>Bank name</label><input class="input" name="bankName" value="${esc(bk.bankName)}" required></div>
      <div class="field"><label>Branch / address</label><input class="input" name="branch" value="${esc(bk.branch)}"></div>
      <div class="field"><label>Account No.</label><input class="input mono" name="accountNo" value="${esc(bk.accountNo)}"></div>
      <div class="field"><label>IBAN</label><input class="input mono" name="iban" value="${esc(bk.iban)}"></div>
      <div class="field"><label>SWIFT / BIC</label><input class="input mono" name="swift" value="${esc(bk.swift)}"></div>
      <div class="field"><label>IFSC / routing (optional)</label><input class="input mono" name="ifsc" value="${esc(bk.ifsc)}"></div>
      <div class="field"><label>Account currency</label><select class="select" name="currency">${opt(CURRENCIES.map(x => x.code), bk.currency)}</select></div>
      <div class="field"><label>Intermediary bank (optional)</label><input class="input" name="intermediary" value="${esc(bk.intermediary)}"></div>
    </form>`);
    const foot = h(`<div class="btn-row right"><button class="btn btn-ghost" data-a="cancel">Cancel</button><button class="btn btn-primary" data-a="ok">${icon('check')} ${bank ? 'Update' : 'Add account'}</button></div>`);
    const m = openModal({ title: bank ? 'Edit bank account' : 'Add bank account', content: body, footer: foot, size: 'lg' });
    foot.querySelector('[data-a="cancel"]').onclick = () => m.close();
    const ok = () => { if (!body.bankName.value.trim()) { toast('Bank name is required', 'warning'); return; } const out = { ...bk }; ['label', 'beneficiary', 'bankName', 'branch', 'accountNo', 'iban', 'swift', 'ifsc', 'currency', 'intermediary'].forEach(k => out[k] = body[k].value.trim()); if (!out.label) out.label = out.bankName; m.close(); onDone(out); };
    foot.querySelector('[data-a="ok"]').onclick = ok; body.onsubmit = e => { e.preventDefault(); ok(); };
  }

  show();
}

function sampleDoc(settings) {
  const d = settings.defaults || {};
  return {
    number: `${settings.numbering.prefix || 'INV'}-${new Date().getFullYear()}-0001`, title: 'COMMERCIAL INVOICE', date: new Date().toISOString().slice(0, 10), currency: d.currency || 'USD', status: 'unpaid', template: settings.branding.template,
    buyerOrderNo: 'PO-2041', exporterRef: 'EXP/24/118',
    consignee: { name: 'Global Trading Co. LLC', contact: 'Ahmed Khan', address: 'Warehouse 12, Al Quoz Industrial Area 3', city: 'Dubai', country: 'United Arab Emirates', phone: '+971 50 000 0000', email: 'purchase@globaltrading.ae', taxId: '100000000000003' },
    notifySameAsConsignee: true,
    shipment: { countryOfOrigin: d.countryOfOrigin || 'India', countryOfDestination: 'United Arab Emirates', portOfLoading: d.portOfLoading || 'Nhava Sheva', portOfDischarge: 'Jebel Ali', finalDestination: 'Dubai', transportMode: 'Sea', vessel: 'MSC AURORA V.221', incoterm: d.incoterm || 'FOB', paymentTerms: d.paymentTerms || '100% advance by T/T', containerNo: 'MSCU 123456-7' },
    items: [{ description: 'Premium Basmati Rice, 1121 Steam, 5kg bags', hsCode: '100630', qty: 2000, unit: 'BAG', rate: 7.8 }, { description: 'Turmeric Powder, 25kg PP bags', hsCode: '091030', qty: 400, unit: 'BAG', rate: 42 }],
    packages: { count: 2400, kind: 'Bags', netWeight: 20000, grossWeight: 20480 },
    charges: { freight: 1200, insurance: 180, discount: 0, discountType: 'amount', taxRate: 0, taxLabel: d.taxLabel || 'VAT' },
    bankId: settings.banks[0] ? settings.banks[0].id : null, showBank: true, showStamp: true, showSignature: true, showStatusStamp: false,
    declaration: d.declaration || '', terms: (settings.terms && settings.terms.lines) || [],
  };
}
