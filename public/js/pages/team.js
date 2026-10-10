/** Team page: manage users (admin only) + activity log. */
import { api } from '../api.js';
import { h, icon, esc, toast, openModal, confirmDialog, setBusy, initials, fmtDate, relTime } from '../ui.js';
import { store } from '../app.js';

function roleBadge(r) { return `<span class="badge badge-${r === 'admin' ? 'admin' : 'staff'}">${r === 'admin' ? 'Admin' : 'Staff'}</span>`; }
function activeBadge(a) { return `<span class="badge badge-${a ? 'active' : 'inactive'}"><i></i>${a ? 'Active' : 'Disabled'}</span>`; }

const ACTION_TEXT = { login: 'signed in', create: 'created', update: 'updated', delete: 'deleted', status: 'changed status of', setup: 'set up', };
const ACTION_ICON = { login: 'user', create: 'plus', update: 'edit', delete: 'trash', status: 'check', setup: 'sparkle' };

export async function render(root) {
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Team</h1><p class="lead">Invite colleagues, assign roles and keep an eye on activity.</p></div>
      <button class="btn btn-primary" data-act="add">${icon('plus')} Add user</button></div>
    <div class="stat-grid users-stats"></div>
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:18px" class="team-grid">
      <div class="card"><div class="card-head"><h3>${icon('team')} Users</h3></div><div class="table-wrap users-table"><div class="card-body"><div class="skeleton" style="height:120px"></div></div></div></div>
      <div class="card"><div class="card-head"><h3>${icon('clock')} Recent activity</h3></div><div class="card-body activity"><div class="skeleton" style="height:120px"></div></div></div>
    </div>
  </div>
  <style>@media (max-width: 900px){ .team-grid { grid-template-columns: 1fr !important; } }</style>`;

  const page = root.querySelector('.page');
  page.querySelector('[data-act="add"]').onclick = () => userModal(null, load);

  async function load() {
    let data;
    try { data = await api.get('/api/users'); } catch (e) { toast(e.message, 'error'); return; }
    const users = data.users;
    page.querySelector('.users-stats').innerHTML = `
      <div class="card stat"><div class="stat-top"><span class="stat-label">Team members</span><span class="stat-icon teal">${icon('team')}</span></div><div class="stat-value">${users.length}</div><div class="stat-sub">${users.filter(u => u.active).length} active</div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Administrators</span><span class="stat-icon violet">${icon('shield')}</span></div><div class="stat-value">${users.filter(u => u.role === 'admin').length}</div><div class="stat-sub">full access</div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Invoices created</span><span class="stat-icon amber">${icon('fileText')}</span></div><div class="stat-value">${users.reduce((s, u) => s + Number(u.invoice_count || 0), 0)}</div><div class="stat-sub">by the whole team</div></div>`;

    page.querySelector('.users-table').innerHTML = `<table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th class="hide-sm">Invoices</th><th class="hide-sm">Last login</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr data-id="${u.id}">
        <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="background:${avatarColor(u.name)}">${esc(initials(u.name))}</div><div><div class="strong">${esc(u.name)}${u.id === store.user.id ? ' <span class="tiny muted">(you)</span>' : ''}</div><div class="small muted">${esc(u.email)}</div></div></div></td>
        <td>${roleBadge(u.role)}</td><td>${activeBadge(u.active)}</td>
        <td class="hide-sm mono">${u.invoice_count || 0}</td>
        <td class="hide-sm small muted">${u.last_login ? relTime(u.last_login) : 'never'}</td>
        <td><div class="actions"><button class="icon-btn" title="Edit" data-edit="${u.id}">${icon('edit')}</button>${u.id !== store.user.id ? `<button class="icon-btn danger" title="Delete" data-del="${u.id}">${icon('trash')}</button>` : ''}</div></td>
      </tr>`).join('')}
    </tbody></table>`;
    page.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => userModal(users.find(u => u.id === Number(b.dataset.edit)), load));
    page.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const u = users.find(x => x.id === Number(b.dataset.del));
      if (!(await confirmDialog({ title: `Delete ${u.name}?`, message: 'Their invoices are kept but will no longer show their name as creator. This cannot be undone.', confirmText: 'Delete user', danger: true }))) return;
      try { await api.del(`/api/users/${u.id}`); toast('User deleted', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
    });

    page.querySelector('.activity').innerHTML = data.activity.length ? data.activity.map(a => `<div class="act-row"><div class="act-dot">${icon(ACTION_ICON[a.action] || 'info')}</div><div class="act-text"><strong>${esc(a.user_name || 'Someone')}</strong> ${esc(ACTION_TEXT[a.action] || a.action)} ${a.action === 'login' ? '' : esc(a.entity || '')} ${a.details ? `<span class="muted">· ${esc(a.details)}</span>` : ''}</div><div class="act-time">${relTime(a.created_at)}</div></div>`).join('')
      : `<div class="empty-state">${icon('clock')}<h4>No activity yet</h4></div>`;
  }
  load();
}

function avatarColor(name) {
  const palettes = ['linear-gradient(135deg,#f59e0b,#ef4444)', 'linear-gradient(135deg,#14b8a6,#2563eb)', 'linear-gradient(135deg,#7c3aed,#ec4899)', 'linear-gradient(135deg,#0ea5e9,#22c55e)', 'linear-gradient(135deg,#f97316,#eab308)'];
  let s = 0; for (const c of String(name || '')) s += c.charCodeAt(0);
  return palettes[s % palettes.length];
}

function userModal(user, onDone) {
  const isEdit = !!user;
  const body = h(`<form class="auth-form" novalidate>
    <div class="form-grid">
      <div class="field"><label>Full name</label><input class="input" name="name" value="${esc(user ? user.name : '')}" placeholder="Jane Doe" required></div>
      <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${esc(user ? user.email : '')}" placeholder="jane@company.com" required></div>
      <div class="field"><label>Role</label><select class="select" name="role"><option value="staff" ${user && user.role === 'staff' ? 'selected' : ''}>Staff — create & manage invoices</option><option value="admin" ${user && user.role === 'admin' ? 'selected' : ''}>Admin — full access</option></select></div>
      <div class="field"><label>${isEdit ? 'New password (optional)' : 'Password'}</label><input class="input" type="password" name="password" placeholder="${isEdit ? 'Leave blank to keep' : 'Min. 6 characters'}" ${isEdit ? '' : 'required'}></div>
      ${isEdit ? `<div class="field span-2"><label class="switch"><input type="checkbox" name="active" ${user.active ? 'checked' : ''}><span class="track"></span><span>Account active (can sign in)</span></label></div>` : ''}
    </div>
    <div class="err"></div>
  </form>`);
  const foot = h(`<div class="btn-row right"><button class="btn btn-ghost" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="save">${icon('check')} ${isEdit ? 'Save changes' : 'Create user'}</button></div>`);
  const m = openModal({ title: isEdit ? `Edit ${user.name}` : 'Add team member', content: body, footer: foot });
  foot.querySelector('[data-act="cancel"]').onclick = () => m.close();
  const save = async () => {
    const err = body.querySelector('.err'); err.innerHTML = '';
    const btn = foot.querySelector('[data-act="save"]'); setBusy(btn, true, 'Saving…');
    const payload = { name: body.name.value, email: body.email.value, role: body.role.value };
    if (body.password.value) payload.password = body.password.value;
    if (isEdit) payload.active = body.active.checked;
    try {
      if (isEdit) await api.put(`/api/users/${user.id}`, payload); else await api.post('/api/users', payload);
      toast(isEdit ? 'User updated' : 'User created', 'success'); m.close(); onDone();
    } catch (e) { err.innerHTML = `<div class="form-error">${icon('alert')}<span>${esc(e.message)}</span></div>`; setBusy(btn, false); }
  };
  foot.querySelector('[data-act="save"]').onclick = save;
  body.onsubmit = e => { e.preventDefault(); save(); };
}
