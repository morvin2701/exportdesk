/** Platform owner page: the `exportdesklink` registry — one row per client company + their SQL Server. */
import { api } from '../api.js';
import { h, icon, esc, toast, openModal, confirmDialog, setBusy, relTime, fmtDate } from '../ui.js';
import { navigate } from '../app.js';

function statusChip(c) {
  if (!c.active) return '<span class="badge badge-cancelled"><i></i>Disabled</span>';
  if (!c.db_server) return '<span class="badge badge-draft"><i></i>Not configured</span>';
  if (!c.db_ready) return '<span class="badge badge-unpaid"><i></i>DB not created</span>';
  if (c.last_status && /^ERROR/.test(c.last_status)) return '<span class="badge badge-cancelled"><i></i>Connection error</span>';
  return '<span class="badge badge-paid"><i></i>Ready</span>';
}

export async function render(root, params) {
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Clients</h1><p class="lead">Each client keeps their invoices on <strong>their own</strong> SQL Server. This table only stores how to reach it.</p></div>
      <button class="btn btn-primary" data-act="add">${icon('plus')} Add client</button></div>
    <div class="stat-grid stats"></div>
    <div class="card">
      <div class="card-head"><h3>${icon('globe')} exportdesklink</h3><div class="input-group" style="width:260px">${icon('search')}<input class="input sm" placeholder="Search code, name, server…" data-q></div></div>
      <div class="table-wrap list"><div class="card-body"><div class="skeleton" style="height:120px"></div></div></div>
    </div>
  </div>`;
  const page = root.querySelector('.page');
  let items = [];
  page.querySelector('[data-act="add"]').onclick = () => clientModal(null, load);
  page.querySelector('[data-q]').oninput = () => drawList();
  if (params.new) setTimeout(() => clientModal(null, load), 50);

  async function load() {
    try { items = (await api.get('/api/platform/clients')).items; } catch (e) { toast(e.message, 'error'); return; }
    const ready = items.filter(c => c.db_ready && c.active).length, issues = items.filter(c => c.last_status && /^ERROR/.test(c.last_status)).length;
    page.querySelector('.stats').innerHTML = `
      <div class="card stat"><div class="stat-top"><span class="stat-label">Clients</span><span class="stat-icon teal">${icon('building')}</span></div><div class="stat-value">${items.length}</div><div class="stat-sub">${items.filter(c => c.active).length} active</div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Ready</span><span class="stat-icon green">${icon('check')}</span></div><div class="stat-value">${ready}</div><div class="stat-sub">database created & reachable</div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Pending setup</span><span class="stat-icon amber">${icon('clock')}</span></div><div class="stat-value">${items.filter(c => !c.db_ready).length}</div><div class="stat-sub">waiting for SQL Server details</div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Connection issues</span><span class="stat-icon violet">${icon('alert')}</span></div><div class="stat-value">${issues}</div><div class="stat-sub">last test failed</div></div>`;
    drawList();
  }

  function drawList() {
    const q = page.querySelector('[data-q]').value.trim().toLowerCase();
    const rows = items.filter(c => !q || [c.code, c.name, c.db_server, c.contact_name, c.contact_email].some(v => String(v || '').toLowerCase().includes(q)));
    const list = page.querySelector('.list');
    if (!rows.length) { list.innerHTML = `<div class="empty-state">${icon('globe')}<h4>${items.length ? 'No clients match' : 'No clients yet'}</h4><p>${items.length ? 'Try another search.' : 'Add your first client company and its SQL Server.'}</p></div>`; return; }
    list.innerHTML = `<table class="table"><thead><tr><th>Client</th><th>SQL Server</th><th>Status</th><th class="hide-sm">Last check</th><th></th></tr></thead><tbody>
      ${rows.map(c => `<tr data-id="${c.id}">
        <td><div class="strong">${esc(c.name)} <span class="chip mono" style="margin-left:6px">${esc(c.code)}</span></div><div class="small muted">${esc([c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · ') || '—')}</div></td>
        <td>${c.db_server ? `<div class="mono small">${esc(c.db_server)}${c.db_port ? ',' + c.db_port : ''}</div><div class="tiny muted">${esc(c.db_database || '')} · ${esc(c.db_user || '')}</div>` : '<span class="muted small">not set — share the activation key</span>'}</td>
        <td>${statusChip(c)}</td>
        <td class="hide-sm small muted" title="${esc(c.last_status || '')}">${c.last_checked ? relTime(c.last_checked) : '—'}<div class="tiny" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.last_status || '')}</div></td>
        <td><div class="actions">
          <button class="icon-btn" title="Test connection" data-a="test">${icon('refresh')}</button>
          <button class="icon-btn" title="Create database" data-a="install">${icon('db')}</button>
          <button class="icon-btn" title="Users / first admin" data-a="users">${icon('team')}</button>
          <button class="icon-btn" title="Activation key & setup link" data-a="key">${icon('shield')}</button>
          <button class="icon-btn" title="Edit" data-a="edit">${icon('edit')}</button>
          <button class="icon-btn danger" title="Remove" data-a="del">${icon('trash')}</button>
        </div></td></tr>`).join('')}
    </tbody></table>`;
    list.querySelectorAll('tbody tr').forEach(tr => {
      const c = items.find(x => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-a="edit"]').onclick = () => clientModal(c, load);
      tr.querySelector('[data-a="key"]').onclick = () => keyModal(c, load);
      tr.querySelector('[data-a="users"]').onclick = () => usersModal(c, load);
      tr.querySelector('[data-a="test"]').onclick = async e => { setBusy(e.currentTarget, true); try { const r = await api.post(`/api/platform/clients/${c.id}/test`, {}); toast(`${c.name}: connected · SQL Server ${r.version}${r.dbExists ? ' · database exists' : ' · database not created yet'}`, 'success', 6000); } catch (ex) { toast(ex.message, 'error', 8000); } finally { load(); } };
      tr.querySelector('[data-a="install"]').onclick = async e => { if (!c.db_server) { toast('Set the SQL Server details first (Edit)', 'warning'); return; } setBusy(e.currentTarget, true); try { const r = await api.post(`/api/platform/clients/${c.id}/install`, {}); toast(`Database ${r.database} is ready on ${c.name}'s server`, 'success'); } catch (ex) { toast(ex.message, 'error', 8000); } finally { load(); } };
      tr.querySelector('[data-a="del"]').onclick = async () => { if (!(await confirmDialog({ title: `Remove ${c.name}?`, message: 'Only the registry entry is removed. The client\'s database and invoices on their own SQL Server stay untouched.', confirmText: 'Remove', danger: true }))) return; try { await api.del(`/api/platform/clients/${c.id}`); toast('Client removed', 'success'); load(); } catch (ex) { toast(ex.message, 'error'); } };
    });
  }

  load();
}

function clientModal(c, onDone) {
  const isEdit = !!c;
  const body = h(`<form class="auth-form" novalidate>
    <div class="form-grid">
      <div class="field"><label>Company name</label><input class="input" name="name" value="${esc(c ? c.name : '')}" placeholder="Acme Exports LLC" required></div>
      <div class="field"><label>Company code</label><input class="input mono" name="code" value="${esc(c ? c.code : '')}" placeholder="ACME" style="text-transform:uppercase" required><div class="hint">Users type this at sign-in. Letters, numbers, - and _.</div></div>
      <div class="field"><label>Contact person</label><input class="input" name="contact_name" value="${esc(c ? c.contact_name || '' : '')}"></div>
      <div class="field"><label>Contact email</label><input class="input" type="email" name="contact_email" value="${esc(c ? c.contact_email || '' : '')}"></div>
      <div class="field"><label>Contact phone</label><input class="input" name="contact_phone" value="${esc(c ? c.contact_phone || '' : '')}"></div>
      ${isEdit ? `<div class="field"><label>&nbsp;</label><label class="switch"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}><span class="track"></span><span>Active (users can sign in)</span></label></div>` : '<div></div>'}
      <div class="divider span-2" style="margin:2px 0"></div>
      <div class="field span-2"><div class="label">Client's SQL Server <span class="muted" style="font-weight:500">(leave empty to let the client enter it with the activation key)</span></div></div>
      <div class="field span-2"><label>Server address</label><div class="input-group">${icon('db')}<input class="input mono" name="db_server" value="${esc(c ? c.db_server || '' : '')}" placeholder="103.1.2.3,1433  or  office.ddns.net,1433"></div><div class="hint">Public IP / DDNS hostname of the client's PC with the forwarded port. A Windows computer name (WIN-xxx\\SQLEXPRESS) only works inside their office.</div></div>
      <div class="field"><label>Authentication</label><select class="select" name="db_auth"><option value="sql" ${!c || c.db_auth !== 'windows' ? 'selected' : ''}>SQL Server Authentication</option><option value="windows" ${c && c.db_auth === 'windows' ? 'selected' : ''}>Windows Authentication</option></select></div>
      <div class="field"><label>Domain (Windows auth only)</label><input class="input mono" name="db_domain" value="${esc(c ? c.db_domain || '' : '')}"></div>
      <div class="field"><label>Login</label><input class="input mono" name="db_user" value="${esc(c ? c.db_user || '' : '')}" placeholder="sa"></div>
      <div class="field"><label>Password ${isEdit && c.has_password ? '<span class="muted">(leave blank to keep)</span>' : ''}</label><input class="input" type="password" name="db_password" autocomplete="new-password"></div>
      <div class="field"><label>Database name</label><input class="input mono" name="db_database" value="${esc(c ? c.db_database || '' : '')}" placeholder="ExportDesk_ACME"><div class="hint">Created on their server if it doesn't exist.</div></div>
      <div class="field"><label>&nbsp;</label><label class="switch"><input type="checkbox" name="db_encrypt" ${!c || c.db_encrypt ? 'checked' : ''}><span class="track"></span><span>Encrypt connection</span></label></div>
      <div class="field span-2"><label>Notes</label><textarea class="textarea" name="notes" rows="2" style="min-height:56px">${esc(c ? c.notes || '' : '')}</textarea></div>
    </div>
    <div class="err"></div>
  </form>`);
  body.querySelector('[name="name"]').addEventListener('input', e => { const code = body.querySelector('[name="code"]'); if (!isEdit && !code.dataset.touched) code.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12); });
  body.querySelector('[name="code"]').addEventListener('input', e => { e.target.dataset.touched = '1'; });
  const foot = h(`<div class="btn-row right"><button class="btn btn-ghost" data-a="cancel">Cancel</button><button class="btn btn-primary" data-a="save">${icon('check')} ${isEdit ? 'Save changes' : 'Add client'}</button></div>`);
  const m = openModal({ title: isEdit ? `Edit ${c.name}` : 'Add client', content: body, footer: foot, size: 'lg' });
  foot.querySelector('[data-a="cancel"]').onclick = () => m.close();
  const save = async () => {
    const err = body.querySelector('.err'); err.innerHTML = '';
    const btn = foot.querySelector('[data-a="save"]'); setBusy(btn, true, 'Saving…');
    const f = n => body.querySelector(`[name="${n}"]`);
    const payload = { name: f('name').value, code: f('code').value, contact_name: f('contact_name').value, contact_email: f('contact_email').value, contact_phone: f('contact_phone').value,
      db_server: f('db_server').value, db_auth: f('db_auth').value, db_domain: f('db_domain').value, db_user: f('db_user').value, db_database: f('db_database').value, db_encrypt: f('db_encrypt').checked, notes: f('notes').value };
    if (f('db_password').value) payload.db_password = f('db_password').value;
    if (isEdit) payload.active = f('active').checked;
    try {
      if (isEdit) await api.put(`/api/platform/clients/${c.id}`, payload); else await api.post('/api/platform/clients', payload);
      toast(isEdit ? 'Client updated' : 'Client added — now Test and Create database, or share the activation key', 'success', 5000); m.close(); onDone();
    } catch (e) { err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(e.message)}</span></div>`; setBusy(btn, false); }
  };
  foot.querySelector('[data-a="save"]').onclick = save;
  body.onsubmit = e => { e.preventDefault(); save(); };
}

function keyModal(c, onDone) {
  const link = `${location.origin}${location.pathname}#/activate?code=${encodeURIComponent(c.code)}`;
  const body = h(`<div class="auth-form">
    <div class="note">${icon('info')}<span>Send the client the <strong>setup link</strong> and the <strong>activation key</strong>. They open the link, enter the key, connect their SQL Server and create their admin — no installation needed on their side except SQL Server itself.</span></div>
    <div class="field"><label>Company code</label><input class="input mono" value="${esc(c.code)}" readonly></div>
    <div class="field"><label>Activation key</label><div class="input-group"><input class="input mono" value="${esc(c.activation_key || '')}" readonly style="padding-left:12px;padding-right:90px"><button class="btn btn-secondary btn-sm ig-btn" data-copy="${esc(c.activation_key || '')}">${icon('copy')} Copy</button></div></div>
    <div class="field"><label>Setup link</label><div class="input-group"><input class="input mono" value="${esc(link)}" readonly style="padding-left:12px;padding-right:90px"><button class="btn btn-secondary btn-sm ig-btn" data-copy="${esc(link)}">${icon('copy')} Copy</button></div></div>
    <div class="field"><label>Message to send</label><textarea class="textarea" rows="6" readonly>Hello ${esc(c.contact_name || c.name)},

Your ExportDesk account is ready.
1. Open: ${link}
2. Company code: ${c.code}
3. Activation key: ${c.activation_key || ''}
4. Enter your SQL Server public address (ip,port), login and password, then create your admin user.

Note: your router must forward TCP port 1433 to the PC running SQL Server, and TCP/IP must be enabled in SQL Server Configuration Manager.</textarea></div>
  </div>`);
  const foot = h(`<div class="btn-row between"><button class="btn btn-ghost" data-a="regen">${icon('refresh')} New key</button><button class="btn btn-primary" data-a="close">Done</button></div>`);
  const m = openModal({ title: `Activation · ${c.name}`, content: body, footer: foot });
  body.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied', 'success', 1500); } catch (e) { toast('Copy failed — select and copy manually', 'warning'); } });
  foot.querySelector('[data-a="close"]').onclick = () => m.close();
  foot.querySelector('[data-a="regen"]').onclick = async () => { if (!(await confirmDialog({ title: 'Generate a new activation key?', message: 'The old key stops working immediately.', confirmText: 'New key' }))) return; try { await api.post(`/api/platform/clients/${c.id}/key`); toast('New key generated', 'success'); m.close(); onDone(); } catch (e) { toast(e.message, 'error'); } };
}

async function usersModal(c, onDone) {
  const body = h(`<div class="auth-form"><div class="skeleton" style="height:80px"></div></div>`);
  const foot = h(`<div class="btn-row between"><button class="btn btn-secondary" data-a="admin">${icon('plus')} Create first admin</button><button class="btn btn-primary" data-a="close">Done</button></div>`);
  const m = openModal({ title: `Users · ${c.name}`, content: body, footer: foot, size: 'lg' });
  foot.querySelector('[data-a="close"]').onclick = () => m.close();
  async function loadUsers() {
    if (!c.db_server) { body.innerHTML = `<div class="note warn">${icon('alert')}<span>No SQL Server configured yet. Edit the client or share the activation key.</span></div>`; return; }
    try {
      const r = await api.get(`/api/platform/clients/${c.id}/users`);
      body.innerHTML = r.items.length ? `<table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>${r.items.map(u => `<tr><td><div class="strong">${esc(u.name)}</div><div class="small muted">${esc(u.email)}</div></td><td><span class="badge badge-${u.role === 'admin' ? 'admin' : 'staff'}">${esc(u.role)}</span></td><td>${u.active ? '<span class="badge badge-active"><i></i>Active</span>' : '<span class="badge badge-inactive"><i></i>Disabled</span>'}</td><td class="small muted">${u.last_login ? relTime(u.last_login) : 'never'}</td><td><button class="btn btn-ghost btn-sm" data-reset="${u.id}">${icon('shield', 'sm')} Reset password</button></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state">${icon('team')}<h4>No users yet</h4><p>Create the first admin for this client, or let them do it with the activation key.</p></div>`;
      body.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
        const pw = prompt('New password (min. 6 characters):'); if (!pw) return;
        try { await api.post(`/api/platform/clients/${c.id}/users/${b.dataset.reset}/reset`, { password: pw }); toast('Password reset', 'success'); } catch (e) { toast(e.message, 'error'); }
      });
    } catch (e) { body.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(e.message)}</span></div>`; }
  }
  foot.querySelector('[data-a="admin"]').onclick = () => {
    const f = h(`<form class="auth-form" novalidate><div class="form-grid"><div class="field"><label>Name</label><input class="input" name="name" required></div><div class="field"><label>Email</label><input class="input" type="email" name="email" required></div><div class="field span-2"><label>Password</label><input class="input" name="password" type="text" value="${Math.random().toString(36).slice(2, 10)}" required></div></div><div class="err"></div></form>`);
    const ff = h(`<div class="btn-row right"><button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-primary" data-a="ok">${icon('check')} Create admin</button></div>`);
    const mm = openModal({ title: `First admin · ${c.name}`, content: f, footer: ff, size: 'sm' });
    ff.querySelector('[data-a="c"]').onclick = () => mm.close();
    const ok = async () => { const err = f.querySelector('.err'); err.innerHTML = ''; setBusy(ff.querySelector('[data-a="ok"]'), true, 'Creating…'); try { await api.post(`/api/platform/clients/${c.id}/admin`, { name: f.name.value, email: f.email.value, password: f.password.value }); toast(`Admin created. Send them: code ${c.code}, email ${f.email.value}, password ${f.password.value}`, 'success', 9000); mm.close(); loadUsers(); onDone(); } catch (e) { err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(e.message)}</span></div>`; setBusy(ff.querySelector('[data-a="ok"]'), false); } };
    ff.querySelector('[data-a="ok"]').onclick = ok; f.onsubmit = e => { e.preventDefault(); ok(); };
  };
  loadUsers();
}
