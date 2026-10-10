/** Invoice editor: form on the left, live A4 preview on the right. */
import { api } from '../api.js';
import { h, icon, esc, toast, confirmDialog, setBusy, debounce, statusBadge } from '../ui.js';
import { store, loadSettings, setNavGuard, setTopbar } from '../app.js';
import { renderInvoice } from '../document.js';
import { printDoc, downloadPdf, safeFilename } from '../export.js';
import { CURRENCIES, COUNTRIES, INCOTERMS, INCOTERM_LABELS, TRANSPORT_MODES, UNITS, PACKAGE_KINDS, STATUSES, computeTotals, fmtMoney, todayISO, addDaysISO, getPath, setPath, deepClone, uid } from '../utils.js';

function blankDoc(settings) {
  const d = settings.defaults || {};
  const company = settings.company || {};
  const banks = settings.banks || [];
  const today = todayISO();
  return {
    id: null, number: '', title: 'COMMERCIAL INVOICE', date: today, dueDate: d.dueDays ? addDaysISO(today, d.dueDays) : '', currency: d.currency || 'USD', status: 'unpaid',
    template: (settings.branding && settings.branding.template) || 'modern',
    buyerOrderNo: '', buyerOrderDate: '', exporterRef: '', lcNo: '', preparedBy: store.user ? store.user.name : '',
    consignee: { name: '', contact: '', address: '', city: '', country: '', phone: '', email: '', taxId: '' },
    notifySameAsConsignee: true, notify: { name: '', address: '' },
    shipment: { countryOfOrigin: d.countryOfOrigin || company.country || '', countryOfDestination: '', preCarriage: '', placeOfReceipt: '', vessel: '', portOfLoading: d.portOfLoading || '', portOfDischarge: '', finalDestination: '', transportMode: d.transportMode || 'Sea', incoterm: d.incoterm || 'FOB', incotermPlace: '', paymentTerms: d.paymentTerms || '', containerNo: '', sealNo: '', marks: '' },
    items: [{ id: uid(), description: '', hsCode: '', qty: 1, unit: d.unit || 'PCS', rate: 0, netWt: '', grossWt: '', marks: '' }],
    packages: { count: '', kind: 'Cartons', netWeight: '', grossWeight: '', dimensions: '' },
    charges: { freight: 0, insurance: 0, other: 0, otherLabel: 'Other charges', discount: 0, discountType: 'amount', taxRate: Number(d.taxRate) || 0, taxLabel: d.taxLabel || 'VAT' },
    bankId: banks[0] ? banks[0].id : null, showBank: true, showWeights: false, showStamp: true, showSignature: true, showStatusStamp: true,
    declaration: d.declaration || '', notes: d.notes || '', terms: (settings.terms && settings.terms.lines) ? [...settings.terms.lines] : [],
    amountPaid: 0,
  };
}

const opt = (list, val, labelFn) => list.map(v => { const value = typeof v === 'object' ? v.value : v; const label = labelFn ? labelFn(v) : (typeof v === 'object' ? v.label : v); return `<option value="${esc(value)}" ${String(value) === String(val) ? 'selected' : ''}>${esc(label)}</option>`; }).join('');
const countryList = `<datalist id="dl-countries">${COUNTRIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;

function section(key, title, iconName, body, { open = true, meta = '' } = {}) {
  return `<div class="fsection ${open ? 'open' : ''}" data-section="${key}"><div class="fsection-head"><span class="fs-icon">${icon(iconName)}</span><h4>${esc(title)}</h4><span class="fs-meta">${meta}</span><span class="fs-chev">${icon('chevron')}</span></div><div class="fsection-body">${body}</div></div>`;
}

export async function render(root, params) {
  const settings = await loadSettings(true);
  let doc, saving = false, dirty = false, savedSnapshot = '';
  const banks = settings.banks || [];

  // ---- Load / new / duplicate ----
  if (params.id) {
    try {
      const row = await api.get(`/api/invoices/${params.id}`);
      doc = { ...blankDoc(settings), ...row.data, id: row.id, number: row.number, status: row.status, amountPaid: Number(row.amount_paid) || 0 };
      doc.items = (doc.items || []).map(it => ({ id: uid(), ...it }));
    } catch (e) { toast(e.message, 'error'); location.hash = '#/invoices'; return; }
  } else if (params.dup) {
    try {
      const row = await api.get(`/api/invoices/${params.dup}`);
      doc = { ...blankDoc(settings), ...row.data, id: null, number: '', status: 'unpaid', amountPaid: 0, date: todayISO() };
      doc.dueDate = settings.defaults && settings.defaults.dueDays ? addDaysISO(doc.date, settings.defaults.dueDays) : '';
      doc.items = (doc.items || []).map(it => ({ id: uid(), ...it }));
      toast(`Duplicated from ${row.number}`, 'info');
    } catch (e) { toast(e.message, 'error'); doc = blankDoc(settings); }
  } else {
    doc = blankDoc(settings);
  }
  if (!doc.id && !doc.number) {
    try { doc.number = (await api.get(`/api/invoices/next-number?date=${doc.date}`)).number; } catch (e) { /* keep blank → auto on save */ }
  }
  if (!settings.company || !settings.company.name) {
    setTimeout(() => toast('Add your company details in Settings so they appear on the invoice.', 'warning', 5000), 400);
  }
  savedSnapshot = JSON.stringify(doc);

  // ---- Layout ----
  root.innerHTML = `
  <div class="mobile-tabs"><div class="seg"><button class="active" data-view="form">${icon('edit')} Details</button><button data-view="preview">${icon('eye')} Preview</button></div></div>
  <div class="editor" data-view="form">
    <div class="editor-form"><div class="editor-form-inner"></div></div>
    <div class="editor-preview">
      <div class="preview-toolbar">
        <div class="ptb-title">${icon('fileText')}<span class="ptb-num mono"></span><span class="dirty-state"></span></div>
        <div class="ptb-right">
          <select class="select sm" data-tool="template" title="Template"><option value="modern">Modern</option><option value="classic">Classic</option><option value="minimal">Minimal</option></select>
          <select class="select sm" data-tool="zoom" title="Zoom"><option value="fit">Fit</option><option value="0.6">60%</option><option value="0.8">80%</option><option value="1">100%</option></select>
          <span class="sep"></span>
          <button class="btn btn-secondary btn-sm" data-tool="print">${icon('print')}<span class="hide-sm">Print</span></button>
          <button class="btn btn-secondary btn-sm" data-tool="pdf">${icon('download')}<span class="hide-sm">PDF</span></button>
          <button class="btn btn-primary btn-sm" data-tool="save">${icon('save')}<span>Save</span></button>
        </div>
      </div>
      <div class="preview-scroll"><div class="preview-stage"></div></div>
    </div>
  </div>${countryList}`;

  const formEl = root.querySelector('.editor-form-inner');
  const stage = root.querySelector('.preview-stage');
  const scroller = root.querySelector('.preview-scroll');
  const editorEl = root.querySelector('.editor');
  const openSections = new Set(['invoice', 'consignee', 'items', 'charges']);

  // Toolbar lives in the top bar on desktop (next to the page title) and above the preview on small screens
  const toolbarEl = root.querySelector('.preview-toolbar');
  const previewEl = root.querySelector('.editor-preview');
  const desktopMq = window.matchMedia('(min-width: 1025px)');
  function placeToolbar() {
    const slot = document.querySelector('.topbar .tb-actions');
    if (desktopMq.matches && slot) { if (toolbarEl.parentElement !== slot) slot.appendChild(toolbarEl); }
    else if (toolbarEl.parentElement !== previewEl) previewEl.prepend(toolbarEl);
  }
  placeToolbar();
  desktopMq.addEventListener('change', placeToolbar);

  // ---- Form rendering ----
  function buildForm() {
    const s = doc.shipment, c = doc.consignee, ch = doc.charges, p = doc.packages;
    formEl.innerHTML = `
    ${section('invoice', 'Invoice details', 'hash', `
      <div class="form-grid">
        <div class="field"><label>Invoice No.</label><input class="input mono" data-bind="number" value="${esc(doc.number)}" placeholder="Auto"><div class="hint">Clear to auto-number on save.</div></div>
        <div class="field"><label>Document title</label><select class="select" data-bind="title">${opt(['COMMERCIAL INVOICE', 'PROFORMA INVOICE', 'TAX INVOICE', 'EXPORT INVOICE', 'INVOICE'], doc.title)}</select></div>
        <div class="field"><label>Invoice date</label><input class="input" type="date" data-bind="date" value="${esc(doc.date)}"></div>
        <div class="field"><label>Due date</label><input class="input" type="date" data-bind="dueDate" value="${esc(doc.dueDate || '')}"></div>
        <div class="field"><label>Currency</label><select class="select" data-bind="currency">${opt(CURRENCIES.map(x => ({ value: x.code, label: `${x.code} — ${x.name}` })), doc.currency)}</select></div>
        <div class="field"><label>Status</label><select class="select" data-bind="status">${opt(STATUSES, doc.status)}</select></div>
        <div class="field ${doc.status === 'partial' ? '' : 'hidden'} paid-field"><label>Amount paid</label><input class="input r mono" type="number" step="0.01" min="0" data-bind="amountPaid" data-type="number" value="${esc(doc.amountPaid || '')}"></div>
        <div class="field"><label>Buyer's order no.</label><input class="input" data-bind="buyerOrderNo" value="${esc(doc.buyerOrderNo)}" placeholder="PO-1024"></div>
        <div class="field"><label>Order date</label><input class="input" type="date" data-bind="buyerOrderDate" value="${esc(doc.buyerOrderDate || '')}"></div>
        <div class="field"><label>Exporter's ref.</label><input class="input" data-bind="exporterRef" value="${esc(doc.exporterRef)}" placeholder="Optional"></div>
        <div class="field"><label>L/C No.</label><input class="input" data-bind="lcNo" value="${esc(doc.lcNo)}" placeholder="Optional"></div>
        <div class="field span-2"><label>Prepared by</label><input class="input" data-bind="preparedBy" value="${esc(doc.preparedBy)}"></div>
      </div>`, { open: openSections.has('invoice') })}

    ${section('consignee', 'Consignee / Buyer', 'building', `
      <div class="form-grid">
        <div class="field span-2 ac-wrap"><label>Company name</label><input class="input" data-bind="consignee.name" value="${esc(c.name)}" placeholder="Start typing to search saved customers" autocomplete="off"></div>
        <div class="field"><label>Contact person</label><input class="input" data-bind="consignee.contact" value="${esc(c.contact)}"></div>
        <div class="field"><label>Tax ID / VAT / TRN</label><input class="input" data-bind="consignee.taxId" value="${esc(c.taxId)}"></div>
        <div class="field span-2"><label>Address</label><textarea class="textarea" data-bind="consignee.address" rows="2" style="min-height:64px">${esc(c.address)}</textarea></div>
        <div class="field"><label>City</label><input class="input" data-bind="consignee.city" value="${esc(c.city)}"></div>
        <div class="field"><label>Country</label><input class="input" data-bind="consignee.country" list="dl-countries" value="${esc(c.country)}"></div>
        <div class="field"><label>Phone</label><input class="input" data-bind="consignee.phone" value="${esc(c.phone)}"></div>
        <div class="field"><label>Email</label><input class="input" type="email" data-bind="consignee.email" value="${esc(c.email)}"></div>
        <div class="field span-2"><label class="switch"><input type="checkbox" data-bind="notifySameAsConsignee" data-type="bool" ${doc.notifySameAsConsignee !== false ? 'checked' : ''}><span class="track"></span><span>Notify party is same as consignee</span></label></div>
        <div class="field span-2 notify-fields ${doc.notifySameAsConsignee !== false ? 'hidden' : ''}"><label>Notify party name</label><input class="input" data-bind="notify.name" value="${esc(doc.notify.name)}"></div>
        <div class="field span-2 notify-fields ${doc.notifySameAsConsignee !== false ? 'hidden' : ''}"><label>Notify party address</label><textarea class="textarea" data-bind="notify.address" rows="2" style="min-height:64px">${esc(doc.notify.address)}</textarea></div>
      </div>`, { open: openSections.has('consignee') })}

    ${section('shipment', 'Shipment & terms', 'ship', `
      <div class="form-grid">
        <div class="field"><label>Incoterm</label><select class="select" data-bind="shipment.incoterm"><option value="">—</option>${opt(INCOTERMS, s.incoterm, v => `${v} — ${INCOTERM_LABELS[v]}`)}</select></div>
        <div class="field"><label>Incoterm place</label><input class="input" data-bind="shipment.incotermPlace" value="${esc(s.incotermPlace)}" placeholder="e.g. Jebel Ali"></div>
        <div class="field span-2"><label>Payment terms</label><input class="input" data-bind="shipment.paymentTerms" value="${esc(s.paymentTerms)}" placeholder="e.g. 30% advance, balance against B/L copy"></div>
        <div class="field"><label>Mode of transport</label><select class="select" data-bind="shipment.transportMode">${opt(TRANSPORT_MODES, s.transportMode)}</select></div>
        <div class="field"><label>Vessel / Flight No.</label><input class="input" data-bind="shipment.vessel" value="${esc(s.vessel)}"></div>
        <div class="field"><label>Country of origin</label><input class="input" data-bind="shipment.countryOfOrigin" list="dl-countries" value="${esc(s.countryOfOrigin)}"></div>
        <div class="field"><label>Country of final destination</label><input class="input" data-bind="shipment.countryOfDestination" list="dl-countries" value="${esc(s.countryOfDestination)}"></div>
        <div class="field"><label>Port of loading</label><input class="input" data-bind="shipment.portOfLoading" value="${esc(s.portOfLoading)}"></div>
        <div class="field"><label>Port of discharge</label><input class="input" data-bind="shipment.portOfDischarge" value="${esc(s.portOfDischarge)}"></div>
        <div class="field"><label>Pre-carriage by</label><input class="input" data-bind="shipment.preCarriage" value="${esc(s.preCarriage)}" placeholder="Truck / Rail"></div>
        <div class="field"><label>Place of receipt</label><input class="input" data-bind="shipment.placeOfReceipt" value="${esc(s.placeOfReceipt)}"></div>
        <div class="field"><label>Final destination</label><input class="input" data-bind="shipment.finalDestination" value="${esc(s.finalDestination)}"></div>
        <div class="field"><label>Container No.</label><input class="input mono" data-bind="shipment.containerNo" value="${esc(s.containerNo)}"></div>
        <div class="field"><label>Seal No.</label><input class="input mono" data-bind="shipment.sealNo" value="${esc(s.sealNo)}"></div>
        <div class="field"><label>Marks & Nos.</label><input class="input" data-bind="shipment.marks" value="${esc(s.marks)}"></div>
      </div>`, { open: openSections.has('shipment') })}

    ${section('items', 'Goods / line items', 'package', `
      <div class="items-editor"></div>
      <div class="btn-row between" style="margin-top:10px">
        <button class="btn btn-secondary btn-sm" data-act="add-item">${icon('plus')} Add item</button>
        <label class="switch"><input type="checkbox" data-bind="showWeights" data-type="bool" ${doc.showWeights ? 'checked' : ''}><span class="track"></span><span>Weight columns</span></label>
      </div>
      <div class="divider"></div>
      <div class="label" style="margin-bottom:8px">Packing summary</div>
      <div class="form-grid cols-3">
        <div class="field"><label>No. of packages</label><input class="input r" type="number" min="0" data-bind="packages.count" data-type="number" value="${esc(p.count)}"></div>
        <div class="field"><label>Kind</label><select class="select" data-bind="packages.kind">${opt(PACKAGE_KINDS, p.kind)}</select></div>
        <div class="field"><label>Dimensions</label><input class="input" data-bind="packages.dimensions" value="${esc(p.dimensions)}" placeholder="e.g. 2 x 40' HC"></div>
        <div class="field"><label>Net weight (KG)</label><input class="input r" type="number" min="0" step="0.001" data-bind="packages.netWeight" data-type="number" value="${esc(p.netWeight)}" placeholder="Auto from items"></div>
        <div class="field"><label>Gross weight (KG)</label><input class="input r" type="number" min="0" step="0.001" data-bind="packages.grossWeight" data-type="number" value="${esc(p.grossWeight)}" placeholder="Auto from items"></div>
      </div>`, { open: openSections.has('items') })}

    ${section('charges', 'Charges, tax & totals', 'dollar', `
      <div class="form-grid">
        <div class="field"><label>Discount</label><div class="input-group has-suffix"><input class="input r" type="number" min="0" step="0.01" data-bind="charges.discount" data-type="number" value="${esc(ch.discount || '')}" style="padding-left:12px"><span class="ig-suffix disc-suffix">${ch.discountType === 'percent' ? '%' : esc(doc.currency)}</span></div></div>
        <div class="field"><label>Discount type</label><select class="select" data-bind="charges.discountType"><option value="amount" ${ch.discountType !== 'percent' ? 'selected' : ''}>Fixed amount</option><option value="percent" ${ch.discountType === 'percent' ? 'selected' : ''}>Percentage</option></select></div>
        <div class="field"><label>Freight</label><input class="input r" type="number" min="0" step="0.01" data-bind="charges.freight" data-type="number" value="${esc(ch.freight || '')}"></div>
        <div class="field"><label>Insurance</label><input class="input r" type="number" min="0" step="0.01" data-bind="charges.insurance" data-type="number" value="${esc(ch.insurance || '')}"></div>
        <div class="field"><label>Other charges label</label><input class="input" data-bind="charges.otherLabel" value="${esc(ch.otherLabel)}"></div>
        <div class="field"><label>Other charges</label><input class="input r" type="number" min="0" step="0.01" data-bind="charges.other" data-type="number" value="${esc(ch.other || '')}"></div>
        <div class="field"><label>Tax label</label><input class="input" data-bind="charges.taxLabel" value="${esc(ch.taxLabel)}" placeholder="VAT / GST"></div>
        <div class="field"><label>Tax rate (%)</label><input class="input r" type="number" min="0" step="0.01" data-bind="charges.taxRate" data-type="number" value="${esc(ch.taxRate || '')}"></div>
      </div>
      <div class="totals-mini"></div>`, { open: openSections.has('charges') })}

    ${section('bank', 'Bank, declaration & notes', 'bank', `
      <div class="form-grid">
        <div class="field span-2"><label>Bank account on invoice</label><select class="select" data-bind="bankId">${banks.length ? opt(banks.map(b => ({ value: b.id, label: `${b.label || b.bankName} · ${b.accountNo || b.iban || ''}` })), doc.bankId) : '<option value="">No bank accounts — add in Settings</option>'}</select></div>
        <div class="field span-2"><label class="switch"><input type="checkbox" data-bind="showBank" data-type="bool" ${doc.showBank !== false ? 'checked' : ''}><span class="track"></span><span>Show bank details on invoice</span></label></div>
        <div class="field span-2"><label>Declaration</label><textarea class="textarea" data-bind="declaration" rows="2">${esc(doc.declaration)}</textarea></div>
        <div class="field span-2"><label>Notes (shown on invoice)</label><textarea class="textarea" data-bind="notes" rows="2" style="min-height:60px" placeholder="Optional">${esc(doc.notes)}</textarea></div>
        <div class="field span-2"><label>Terms & conditions (one per line)</label><textarea class="textarea" data-bind="terms" data-type="lines" rows="3">${esc((doc.terms || []).join('\n'))}</textarea></div>
      </div>`, { open: openSections.has('bank') })}

    ${section('appearance', 'Appearance', 'sparkle', `
      <div class="form-grid">
        <div class="field span-2"><label class="switch"><input type="checkbox" data-bind="showStamp" data-type="bool" ${doc.showStamp !== false ? 'checked' : ''}><span class="track"></span><span>Show company stamp</span></label></div>
        <div class="field span-2"><label class="switch"><input type="checkbox" data-bind="showSignature" data-type="bool" ${doc.showSignature !== false ? 'checked' : ''}><span class="track"></span><span>Show signature</span></label></div>
        <div class="field span-2"><label class="switch"><input type="checkbox" data-bind="showStatusStamp" data-type="bool" ${doc.showStatusStamp !== false ? 'checked' : ''}><span class="track"></span><span>Show PAID / DRAFT / CANCELLED watermark</span></label></div>
        <div class="field span-2"><div class="note">${icon('info')}<span>Logo, stamp, signature, accent colour and default template are managed in <a href="#/settings">Settings → Branding</a>.</span></div></div>
      </div>`, { open: openSections.has('appearance') })}`;

    buildItems();
    updateTotalsMini();

    // Section toggles
    formEl.querySelectorAll('.fsection-head').forEach(head => head.onclick = () => {
      const sec = head.parentElement; sec.classList.toggle('open');
      if (sec.classList.contains('open')) openSections.add(sec.dataset.section); else openSections.delete(sec.dataset.section);
    });
    formEl.querySelector('[data-act="add-item"]').onclick = () => { doc.items.push({ id: uid(), description: '', hsCode: '', qty: 1, unit: (settings.defaults && settings.defaults.unit) || 'PCS', rate: 0, netWt: '', grossWt: '', marks: '' }); buildItems(); markDirty(); schedulePreview(); setTimeout(() => { const rows = formEl.querySelectorAll('.item-row'); const last = rows[rows.length - 1]; if (last) last.querySelector('textarea').focus(); }, 30); };
    wireCustomerAutocomplete(formEl.querySelector('[data-bind="consignee.name"]'));
  }

  function buildItems() {
    const host = formEl.querySelector('.items-editor');
    const t = computeTotals(doc);
    host.innerHTML = doc.items.map((it, i) => `
      <div class="item-row" data-idx="${i}">
        <div class="ir-idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="ir-fields">
          <div class="f-desc"><textarea class="textarea" rows="1" style="min-height:38px;padding:8px 10px" data-item="${i}" data-f="description" placeholder="Description of goods">${esc(it.description)}</textarea></div>
          <div class="f-hs"><input class="input sm mono" data-item="${i}" data-f="hsCode" value="${esc(it.hsCode)}" placeholder="HS code"></div>
          <div class="f-qty"><input class="input sm r" type="number" min="0" step="any" data-item="${i}" data-f="qty" data-type="number" value="${esc(it.qty)}" placeholder="Qty"></div>
          <div class="f-unit"><select class="select sm" data-item="${i}" data-f="unit">${opt(UNITS, it.unit)}</select></div>
          <div class="f-rate"><input class="input sm r" type="number" min="0" step="any" data-item="${i}" data-f="rate" data-type="number" value="${esc(it.rate)}" placeholder="Rate"></div>
          <div class="f-amt"><div class="ir-amount" title="Amount">${fmtMoney(t.items[i].amount, doc.currency)}</div></div>
          ${doc.showWeights ? `<div class="f-w"><input class="input sm r" type="number" min="0" step="any" data-item="${i}" data-f="netWt" data-type="number" value="${esc(it.netWt)}" placeholder="Net wt (KG)"></div><div class="f-w"><input class="input sm r" type="number" min="0" step="any" data-item="${i}" data-f="grossWt" data-type="number" value="${esc(it.grossWt)}" placeholder="Gross wt (KG)"></div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <button class="icon-btn sm danger" data-del-item="${i}" title="Remove">${icon('trash')}</button>
          ${i > 0 ? `<button class="icon-btn sm" data-up-item="${i}" title="Move up">${icon('chevron')}</button>` : ''}
        </div>
      </div>`).join('');
    host.querySelectorAll('[data-del-item]').forEach(b => b.onclick = () => { if (doc.items.length === 1) { doc.items[0] = { id: uid(), description: '', hsCode: '', qty: 1, unit: 'PCS', rate: 0, netWt: '', grossWt: '', marks: '' }; } else doc.items.splice(Number(b.dataset.delItem), 1); buildItems(); markDirty(); schedulePreview(); });
    host.querySelectorAll('[data-up-item]').forEach(b => { b.style.transform = 'rotate(180deg)'; b.onclick = () => { const i = Number(b.dataset.upItem); [doc.items[i - 1], doc.items[i]] = [doc.items[i], doc.items[i - 1]]; buildItems(); markDirty(); schedulePreview(); }; });
    host.querySelectorAll('textarea').forEach(autoGrow);
  }

  function autoGrow(ta) { const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(38, ta.scrollHeight) + 'px'; }; ta.addEventListener('input', fit); fit(); }

  function updateTotalsMini() {
    const t = computeTotals(doc); const cur = doc.currency;
    const host = formEl.querySelector('.totals-mini'); if (!host) return;
    host.innerHTML = `<div class="tm-row"><span>Sub total</span><span class="mono">${fmtMoney(t.subtotal, cur)}</span></div>
      ${t.discount ? `<div class="tm-row"><span>Discount</span><span class="mono">- ${fmtMoney(t.discount, cur)}</span></div>` : ''}
      ${t.freight ? `<div class="tm-row"><span>Freight</span><span class="mono">${fmtMoney(t.freight, cur)}</span></div>` : ''}
      ${t.insurance ? `<div class="tm-row"><span>Insurance</span><span class="mono">${fmtMoney(t.insurance, cur)}</span></div>` : ''}
      ${t.other ? `<div class="tm-row"><span>${esc(doc.charges.otherLabel || 'Other')}</span><span class="mono">${fmtMoney(t.other, cur)}</span></div>` : ''}
      ${t.tax ? `<div class="tm-row"><span>${esc(doc.charges.taxLabel || 'Tax')} ${t.taxRate}%</span><span class="mono">${fmtMoney(t.tax, cur)}</span></div>` : ''}
      <div class="tm-row grand"><span>Grand total</span><span class="mono">${esc(cur)} ${fmtMoney(t.grandTotal, cur)}</span></div>`;
    const amts = formEl.querySelectorAll('.ir-amount');
    t.items.forEach((it, i) => { if (amts[i]) amts[i].textContent = fmtMoney(it.amount, cur); });
    const suf = formEl.querySelector('.disc-suffix'); if (suf) suf.textContent = doc.charges.discountType === 'percent' ? '%' : cur;
  }

  // ---- Binding ----
  formEl.addEventListener('input', onFieldChange);
  formEl.addEventListener('change', onFieldChange);
  function onFieldChange(e) {
    const el = e.target;
    if (el.dataset.item != null) {
      const it = doc.items[Number(el.dataset.item)]; if (!it) return;
      it[el.dataset.f] = el.dataset.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      updateTotalsMini(); markDirty(); schedulePreview(); return;
    }
    const path = el.dataset.bind; if (!path) return;
    let value;
    if (el.dataset.type === 'bool') value = el.checked;
    else if (el.dataset.type === 'number') value = el.value === '' ? '' : Number(el.value);
    else if (el.dataset.type === 'lines') value = el.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    else value = el.value;
    setPath(doc, path, value);
    if (path === 'notifySameAsConsignee') formEl.querySelectorAll('.notify-fields').forEach(f => f.classList.toggle('hidden', value));
    if (path === 'status') { formEl.querySelector('.paid-field').classList.toggle('hidden', value !== 'partial'); }
    if (path === 'showWeights') buildItems();
    if (path === 'currency' || path.startsWith('charges.')) updateTotalsMini();
    if (path === 'number' || path === 'consignee.name') updateNumberLabel();
    if (e.type === 'change' && path === 'date' && !doc.id && settings.defaults && settings.defaults.dueDays && !doc.dueDate) { doc.dueDate = addDaysISO(doc.date, settings.defaults.dueDays); const dd = formEl.querySelector('[data-bind="dueDate"]'); if (dd) dd.value = doc.dueDate; }
    markDirty(); schedulePreview();
  }

  // ---- Customer autocomplete ----
  function wireCustomerAutocomplete(input) {
    if (!input) return;
    const wrap = input.closest('.ac-wrap');
    let list = null, items = [], active = -1;
    const close = () => { if (list) { list.remove(); list = null; } active = -1; };
    const search = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 1) return close();
      try { items = (await api.get(`/api/customers?q=${encodeURIComponent(q)}`)).items; } catch (e) { return; }
      items = items.filter(c => c.name.toLowerCase() !== q.toLowerCase() || !doc.consignee.address);
      if (!items.length) return close();
      close();
      list = h(`<div class="ac-list">${items.map((c, i) => `<div class="ac-item" data-i="${i}"><strong>${esc(c.name)}</strong><span>${esc([c.city, c.country].filter(Boolean).join(', ') || c.email || '')}</span></div>`).join('')}</div>`);
      list.querySelectorAll('.ac-item').forEach(el => el.onmousedown = ev => { ev.preventDefault(); pick(items[Number(el.dataset.i)]); });
      wrap.appendChild(list);
    }, 180);
    const pick = c => {
      doc.consignee = { name: c.name || '', contact: c.contact || '', address: c.address || '', city: c.city || '', country: c.country || '', phone: c.phone || '', email: c.email || '', taxId: c.tax_id || '' };
      if (!doc.shipment.countryOfDestination && c.country) doc.shipment.countryOfDestination = c.country;
      close(); buildForm(); markDirty(); schedulePreview(); toast(`Loaded ${c.name}`, 'info', 1800);
    };
    input.addEventListener('input', search);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', e => {
      if (!list) return;
      const rows = list.querySelectorAll('.ac-item');
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); return; }
      else if (e.key === 'Escape') { close(); return; }
      rows.forEach((r, i) => r.classList.toggle('active', i === active));
    });
  }

  // ---- Preview ----
  const schedulePreview = debounce(renderPreview, 90);
  function renderPreview() {
    stage.innerHTML = renderInvoice(doc, { ...settings, branding: { ...settings.branding } });
    applyZoom();
  }
  function updateNumberLabel() {
    root.querySelector('.ptb-num') && (root.querySelector('.ptb-num').textContent = doc.number || 'AUTO');
    const t = toolbarEl.querySelector('.ptb-num'); if (t) t.textContent = doc.number || 'AUTO';
    setTopbar({ title: doc.id ? `Invoice ${doc.number}` : `New invoice · ${doc.number || 'AUTO'}`, sub: doc.consignee.name || 'Create and preview an export invoice' });
  }
  let zoom = 'fit';
  function applyZoom() {
    const docEl = stage.querySelector('.doc'); if (!docEl) return;
    const avail = scroller.clientWidth - (window.innerWidth <= 720 ? 16 : 48);
    const scale = zoom === 'fit' ? Math.min(1, avail / 794) : Number(zoom);
    stage.style.transform = `scale(${scale})`;
    stage.style.height = `${docEl.offsetHeight * scale}px`;
    stage.style.marginLeft = scale < 1 ? `${Math.max(0, (avail - 794 * scale) / 2 - (avail - 794) / 2)}px` : '';
    stage.style.transformOrigin = 'top left';
    stage.style.marginLeft = `${Math.max(0, (scroller.clientWidth - 794 * scale) / 2 - (window.innerWidth <= 720 ? 8 : 24))}px`;
  }
  const onResize = debounce(applyZoom, 80);
  window.addEventListener('resize', onResize);

  // ---- Dirty state / guards ----
  function markDirty() {
    dirty = JSON.stringify(doc) !== savedSnapshot;
    const pill = dirty ? '<span class="dirty-pill">UNSAVED</span>' : (doc.id ? '<span class="saved-pill">SAVED</span>' : '');
    const el = toolbarEl.querySelector('.dirty-state'); if (el) el.innerHTML = pill;
    const sub = document.querySelector('.topbar .tb-sub');
    if (sub && desktopMq.matches) sub.innerHTML = `${esc(doc.consignee.name || 'Create and preview an export invoice')} ${pill ? '· ' + pill : ''}`;
  }
  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  setNavGuard(async () => !dirty || confirmDialog({ title: 'Discard unsaved changes?', message: 'This invoice has changes that are not saved yet.', confirmText: 'Discard', danger: true }));

  // ---- Toolbar ----
  const tb = toolbarEl;
  tb.querySelector('[data-tool="template"]').value = doc.template || 'modern';
  tb.querySelector('[data-tool="template"]').onchange = e => { doc.template = e.target.value; markDirty(); renderPreview(); };
  tb.querySelector('[data-tool="zoom"]').onchange = e => { zoom = e.target.value; applyZoom(); };
  tb.querySelector('[data-tool="print"]').onclick = () => printDoc(renderInvoice(doc, settings));
  tb.querySelector('[data-tool="pdf"]').onclick = async e => {
    const btn = e.currentTarget; setBusy(btn, true, 'Exporting…');
    try { await downloadPdf(renderInvoice(doc, settings, { forPdf: true }), safeFilename(`${doc.number || 'Invoice'} - ${doc.consignee.name || 'Customer'}.pdf`)); toast('PDF downloaded', 'success'); } catch (ex) { /* toast shown */ } finally { setBusy(btn, false); }
  };
  tb.querySelector('[data-tool="save"]').onclick = save;
  const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);

  async function save() {
    if (saving) return;
    if (!doc.consignee.name.trim()) { toast('Please enter the consignee / buyer name', 'warning'); formEl.querySelector('[data-bind="consignee.name"]').focus(); return; }
    if (!doc.items.some(it => String(it.description || '').trim())) { toast('Add at least one item with a description', 'warning'); return; }
    saving = true;
    const btn = tb.querySelector('[data-tool="save"]'); setBusy(btn, true, 'Saving…');
    try {
      const totals = computeTotals(doc);
      const payload = { number: doc.number, status: doc.status, amount_paid: doc.amountPaid, data: { ...doc, totals, id: undefined } };
      const r = doc.id ? await api.put(`/api/invoices/${doc.id}`, payload) : await api.post('/api/invoices', payload);
      doc.id = r.id; doc.number = r.number;
      formEl.querySelector('[data-bind="number"]').value = doc.number;
      savedSnapshot = JSON.stringify(doc); markDirty(); updateNumberLabel(); renderPreview();
      history.replaceState(null, '', `#/editor/${doc.id}`);
      toast(`Invoice ${doc.number} saved`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { saving = false; setBusy(btn, false); }
  }

  // Mobile view toggle
  root.querySelectorAll('.mobile-tabs button').forEach(b => b.onclick = () => { root.querySelectorAll('.mobile-tabs button').forEach(x => x.classList.toggle('active', x === b)); editorEl.dataset.view = b.dataset.view; if (b.dataset.view === 'preview') setTimeout(applyZoom, 30); });

  // ---- Initial render ----
  buildForm();
  renderPreview();
  updateNumberLabel();
  markDirty();

  return () => {
    desktopMq.removeEventListener('change', placeToolbar);
    toolbarEl.remove();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('keydown', onKey);
  };
}
