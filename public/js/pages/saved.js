/** Saved invoices: stats, filters, list, quick actions. */
import { api } from '../api.js';
import { h, icon, esc, toast, openModal, confirmDialog, setBusy, statusBadge, fmtDate, relTime, debounce } from '../ui.js';
import { store, loadSettings, navigate } from '../app.js';
import { renderInvoice } from '../document.js';
import { printDoc, downloadPdf, safeFilename } from '../export.js';
import { fmtMoney, STATUSES } from '../utils.js';

export async function render(root) {
  const state = { q: '', status: '', from: '', to: '', page: 1, limit: 20, sort: 'updated_at', dir: 'desc', total: 0 };

  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Saved Invoices</h1><p class="lead">Search, review, update status and export.</p></div>
      <button class="btn btn-primary" data-act="new">${icon('plus')} New invoice</button></div>
    <div class="stat-grid stats"><div class="card stat"><div class="skeleton" style="height:60px"></div></div><div class="card stat"><div class="skeleton" style="height:60px"></div></div><div class="card stat"><div class="skeleton" style="height:60px"></div></div><div class="card stat"><div class="skeleton" style="height:60px"></div></div></div>
    <div class="card">
      <div class="card-head" style="flex-wrap:wrap;gap:10px">
        <div class="input-group" style="flex:1;min-width:220px">${icon('search')}<input class="input" placeholder="Search number, customer, country…" data-f="q"></div>
        <select class="select" style="width:170px" data-f="status"><option value="">All statuses</option>${STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
        <input class="input" type="date" style="width:160px" data-f="from" title="From date">
        <input class="input" type="date" style="width:160px" data-f="to" title="To date">
        <button class="icon-btn" data-act="reset" title="Clear filters">${icon('x')}</button>
      </div>
      <div class="table-wrap list"><div class="card-body"><div class="skeleton" style="height:140px"></div></div></div>
      <div class="pager"></div>
    </div>
  </div>`;

  const page = root.querySelector('.page');
  page.querySelector('[data-act="new"]').onclick = () => navigate('#/editor?new=1');
  const filters = page.querySelectorAll('[data-f]');
  const onFilter = debounce(() => { filters.forEach(f => state[f.dataset.f] = f.value); state.page = 1; loadList(); }, 250);
  filters.forEach(f => f.addEventListener('input', onFilter));
  page.querySelector('[data-act="reset"]').onclick = () => { filters.forEach(f => f.value = ''); onFilter(); };

  async function loadStats() {
    try {
      const s = await api.get('/api/invoices/stats');
      const sum = s.summary || {};
      const primary = s.byCurrency[0];
      const fmtCur = (v, c) => c ? `${c} ${fmtMoney(v, c)}` : '0';
      page.querySelector('.stats').innerHTML = `
        <div class="card stat"><div class="stat-top"><span class="stat-label">Total invoices</span><span class="stat-icon teal">${icon('fileText')}</span></div><div class="stat-value">${Number(sum.total_count || 0)}</div><div class="stat-sub">${Number(sum.month_count || 0)} issued this month</div></div>
        <div class="card stat"><div class="stat-top"><span class="stat-label">Billed</span><span class="stat-icon blue">${icon('trend')}</span></div><div class="stat-value">${primary ? fmtCur(primary.billed, primary.currency) : '—'}</div><div class="stat-sub">${s.byCurrency.length > 1 ? s.byCurrency.slice(1).map(c => fmtCur(c.billed, c.currency)).join(' · ') : 'all non-cancelled invoices'}</div></div>
        <div class="card stat"><div class="stat-top"><span class="stat-label">Outstanding</span><span class="stat-icon amber">${icon('clock')}</span></div><div class="stat-value">${primary ? fmtCur(primary.outstanding, primary.currency) : '—'}</div><div class="stat-sub">${Number(sum.open_count || 0)} open invoice${Number(sum.open_count) === 1 ? '' : 's'}${s.byCurrency.length > 1 ? ' · ' + s.byCurrency.slice(1).map(c => fmtCur(c.outstanding, c.currency)).join(' · ') : ''}</div></div>
        <div class="card stat"><div class="stat-top"><span class="stat-label">Collected</span><span class="stat-icon green">${icon('check')}</span></div><div class="stat-value">${primary ? fmtCur(primary.collected, primary.currency) : '—'}</div><div class="stat-sub">${Number(sum.paid_count || 0)} paid in full</div></div>`;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadList() {
    const list = page.querySelector('.list'); const pager = page.querySelector('.pager');
    let data;
    try {
      const qs = new URLSearchParams({ q: state.q, status: state.status, from: state.from, to: state.to, page: state.page, limit: state.limit, sort: state.sort, dir: state.dir });
      data = await api.get(`/api/invoices?${qs}`);
    } catch (e) { toast(e.message, 'error'); return; }
    state.total = data.total;
    if (!data.items.length) {
      list.innerHTML = `<div class="empty-state">${icon('saved')}<h4>${state.q || state.status || state.from || state.to ? 'No invoices match these filters' : 'No invoices yet'}</h4><p>${state.q || state.status ? 'Try clearing the filters.' : 'Create your first invoice and it will show up here.'}</p>${!state.q && !state.status ? `<button class="btn btn-primary" data-act="first">${icon('plus')} Create invoice</button>` : ''}</div>`;
      const b = list.querySelector('[data-act="first"]'); if (b) b.onclick = () => navigate('#/editor?new=1');
      pager.innerHTML = ''; return;
    }
    const sortTh = (col, label, cls = '') => `<th class="${cls}" data-sort="${col}" style="cursor:pointer">${label} ${state.sort === col ? (state.dir === 'asc' ? '↑' : '↓') : ''}</th>`;
    list.innerHTML = `<table class="table"><thead><tr>${sortTh('number', 'Invoice')}${sortTh('customer_name', 'Consignee')}${sortTh('issue_date', 'Date', 'hide-sm')}<th class="hide-sm">Due</th>${sortTh('total', 'Amount', 'r')}${sortTh('status', 'Status')}<th class="hide-sm">By</th><th></th></tr></thead><tbody>
      ${data.items.map(r => `<tr class="clickable" data-id="${r.id}">
        <td><div class="strong mono">${esc(r.number)}</div><div class="tiny muted">${relTime(r.updated_at)}</div></td>
        <td><div class="strong">${esc(r.customer_name)}</div><div class="small muted">${esc(r.customer_country || '')}</div></td>
        <td class="hide-sm">${fmtDate(r.issue_date)}</td>
        <td class="hide-sm ${r.due_date && r.status !== 'paid' && r.status !== 'cancelled' && new Date(r.due_date) < new Date() ? 'strong' : ''}" style="${r.due_date && r.status !== 'paid' && r.status !== 'cancelled' && new Date(r.due_date) < new Date() ? 'color:var(--red)' : ''}">${r.due_date ? fmtDate(r.due_date) : '—'}</td>
        <td class="r"><div class="strong mono">${esc(r.currency)} ${fmtMoney(r.total, r.currency)}</div>${r.status === 'partial' ? `<div class="tiny muted">paid ${fmtMoney(r.amount_paid, r.currency)}</div>` : ''}</td>
        <td>${statusBadge(r.status)}</td>
        <td class="hide-sm small muted">${esc(r.created_by_name || '—')}</td>
        <td><div class="actions">
          <button class="icon-btn" title="Preview" data-a="preview">${icon('eye')}</button>
          <button class="icon-btn" title="Edit" data-a="edit">${icon('edit')}</button>
          <button class="icon-btn" title="Change status" data-a="status">${icon('check')}</button>
          <button class="icon-btn" title="Duplicate" data-a="dup">${icon('copy')}</button>
          <button class="icon-btn danger" title="Delete" data-a="del">${icon('trash')}</button>
        </div></td>
      </tr>`).join('')}
    </tbody></table>`;
    list.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => { const c = th.dataset.sort; if (state.sort === c) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.sort = c; state.dir = c === 'number' || c === 'customer_name' ? 'asc' : 'desc'; } loadList(); });
    list.querySelectorAll('tbody tr').forEach(tr => {
      const row = data.items.find(x => x.id === Number(tr.dataset.id));
      tr.onclick = e => { if (e.target.closest('.actions')) return; navigate(`#/editor/${row.id}`); };
      tr.querySelector('[data-a="edit"]').onclick = () => navigate(`#/editor/${row.id}`);
      tr.querySelector('[data-a="dup"]').onclick = () => navigate(`#/editor?dup=${row.id}`);
      tr.querySelector('[data-a="preview"]').onclick = () => previewModal(row);
      tr.querySelector('[data-a="status"]').onclick = () => statusModal(row, () => { loadList(); loadStats(); });
      tr.querySelector('[data-a="del"]').onclick = async () => {
        if (!(await confirmDialog({ title: `Delete ${row.number}?`, message: 'This permanently removes the invoice from the database.', confirmText: 'Delete', danger: true }))) return;
        try { await api.del(`/api/invoices/${row.id}`); toast('Invoice deleted', 'success'); loadList(); loadStats(); } catch (e) { toast(e.message, 'error'); }
      };
    });
    const pages = Math.max(1, Math.ceil(state.total / state.limit));
    pager.innerHTML = `<span>Showing ${(state.page - 1) * state.limit + 1}–${Math.min(state.page * state.limit, state.total)} of ${state.total}</span>
      <div class="btn-row"><button class="btn btn-secondary btn-sm" data-p="prev" ${state.page <= 1 ? 'disabled' : ''}>${icon('arrowLeft')} Prev</button><span class="small">Page ${state.page} / ${pages}</span><button class="btn btn-secondary btn-sm" data-p="next" ${state.page >= pages ? 'disabled' : ''}>Next ${icon('arrowRight')}</button></div>`;
    pager.querySelector('[data-p="prev"]').onclick = () => { state.page--; loadList(); };
    pager.querySelector('[data-p="next"]').onclick = () => { state.page++; loadList(); };
  }

  async function previewModal(row) {
    const settings = await loadSettings();
    let full;
    try { full = await api.get(`/api/invoices/${row.id}`); } catch (e) { toast(e.message, 'error'); return; }
    const doc = { ...full.data, number: full.number, status: full.status, amountPaid: Number(full.amount_paid) || 0 };
    const html = renderInvoice(doc, settings);
    const body = h(`<div style="background:var(--bg-2);padding:16px;border-radius:12px;overflow:auto"><div class="pv-stage" style="transform-origin:top left;width:210mm">${html}</div></div>`);
    const foot = h(`<div class="btn-row between"><div>${statusBadge(row.status)}</div><div class="btn-row"><button class="btn btn-secondary" data-a="print">${icon('print')} Print</button><button class="btn btn-secondary" data-a="pdf">${icon('download')} PDF</button><button class="btn btn-primary" data-a="edit">${icon('edit')} Edit</button></div></div>`);
    const m = openModal({ title: `${row.number} · ${row.customer_name}`, content: body, footer: foot, size: 'xl' });
    const fit = () => { const w = body.clientWidth - 32; const s = Math.min(1, w / 794); const st = body.querySelector('.pv-stage'); st.style.transform = `scale(${s})`; st.style.height = `${st.querySelector('.doc').offsetHeight * s}px`; };
    setTimeout(fit, 30); window.addEventListener('resize', fit);
    foot.querySelector('[data-a="print"]').onclick = () => printDoc(html);
    foot.querySelector('[data-a="pdf"]').onclick = async e => { setBusy(e.currentTarget, true, 'Exporting…'); try { await downloadPdf(renderInvoice(doc, settings, { forPdf: true }), safeFilename(`${row.number} - ${row.customer_name}.pdf`)); } catch (ex) { /* shown */ } finally { setBusy(e.currentTarget, false); } };
    foot.querySelector('[data-a="edit"]').onclick = () => { m.close(); navigate(`#/editor/${row.id}`); };
  }

  function statusModal(row, onDone) {
    const body = h(`<div class="auth-form">
      <div class="field"><label>Status</label><select class="select" name="status">${STATUSES.map(s => `<option value="${s.value}" ${s.value === row.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div class="field paid ${row.status === 'partial' ? '' : 'hidden'}"><label>Amount paid (${esc(row.currency)})</label><input class="input r mono" type="number" min="0" step="0.01" name="paid" value="${Number(row.amount_paid) || ''}"><div class="hint">Invoice total: ${esc(row.currency)} ${fmtMoney(row.total, row.currency)}</div></div>
    </div>`);
    const foot = h(`<div class="btn-row right"><button class="btn btn-ghost" data-a="cancel">Cancel</button><button class="btn btn-primary" data-a="save">${icon('check')} Update</button></div>`);
    const m = openModal({ title: `Update status · ${row.number}`, content: body, footer: foot, size: 'sm' });
    body.querySelector('[name="status"]').onchange = e => body.querySelector('.paid').classList.toggle('hidden', e.target.value !== 'partial');
    foot.querySelector('[data-a="cancel"]').onclick = () => m.close();
    foot.querySelector('[data-a="save"]').onclick = async e => {
      setBusy(e.currentTarget, true, 'Saving…');
      try { await api.patch(`/api/invoices/${row.id}/status`, { status: body.querySelector('[name="status"]').value, amount_paid: Number(body.querySelector('[name="paid"]').value) || 0 }); toast('Status updated', 'success'); m.close(); onDone(); }
      catch (ex) { toast(ex.message, 'error'); setBusy(e.currentTarget, false); }
    };
  }

  loadStats();
  loadList();
}
