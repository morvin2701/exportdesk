/** Renders an invoice (data + settings) into A4 HTML. Pure function — used by preview, print and PDF. */
import { esc } from './ui.js';
import { fmtMoney, fmtNum, amountInWords, computeTotals, currencyInfo, INCOTERM_LABELS } from './utils.js';

function fmtDocDate(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function lines(text) {
  return esc(text || '').split(/\r?\n/).filter(Boolean).join('<br>');
}

function kv(label, value, opts = {}) {
  if (!value && !opts.always) return '';
  return `<div class="kv"><span class="k">${esc(label)}</span><span class="v">${opts.raw ? value : esc(value || '—')}</span></div>`;
}

export function renderInvoice(doc, settings, options = {}) {
  const company = settings.company || {};
  const branding = settings.branding || {};
  const template = doc.template || branding.template || 'modern';
  const accent = branding.accent || '#0f766e';
  const cur = currencyInfo(doc.currency || 'USD');
  const t = computeTotals(doc);
  const consignee = doc.consignee || {};
  const ship = doc.shipment || {};
  const notify = doc.notifySameAsConsignee !== false ? null : (doc.notify || {});
  const bank = (settings.banks || []).find(b => b.id === doc.bankId) || (settings.banks || [])[0] || null;
  const showWeights = !!doc.showWeights;
  const terms = Array.isArray(doc.terms) ? doc.terms.filter(Boolean) : ((settings.terms && settings.terms.lines) || []);
  const titleText = doc.title || 'COMMERCIAL INVOICE';
  const status = doc.status || 'unpaid';
  const stampText = status === 'paid' ? 'PAID' : status === 'cancelled' ? 'CANCELLED' : status === 'draft' ? 'DRAFT' : '';
  const dec = cur.decimals == null ? 2 : cur.decimals;

  const companyLines = [company.address, [company.city, company.country].filter(Boolean).join(', ')].filter(Boolean);
  const companyContacts = [
    company.phone ? `Tel: ${company.phone}` : '', company.altPhone ? `/ ${company.altPhone}` : '',
    company.email ? `Email: ${company.email}` : '', company.website ? `Web: ${company.website}` : '',
  ].filter(Boolean);
  const regs = [
    company.iec ? `IEC: ${company.iec}` : '', company.taxId ? `${company.taxLabel || 'TRN / GSTIN'}: ${company.taxId}` : '',
    company.pan ? `PAN: ${company.pan}` : '', company.regNo ? `Reg. No: ${company.regNo}` : '',
  ].filter(Boolean);

  const itemRows = t.items.map((it, i) => `
    <tr>
      <td class="c">${String(i + 1).padStart(2, '0')}</td>
      <td class="desc"><div class="d-main">${lines(it.description) || '—'}</div>${it.marks ? `<div class="d-sub">Marks: ${esc(it.marks)}</div>` : ''}</td>
      <td class="c mono">${esc(it.hsCode || '')}</td>
      <td class="r mono">${fmtNum(it.qty, 3)}</td>
      <td class="c">${esc(it.unit || '')}</td>
      ${showWeights ? `<td class="r mono">${it.netWt ? fmtNum(it.netWt, 3) : ''}</td><td class="r mono">${it.grossWt ? fmtNum(it.grossWt, 3) : ''}</td>` : ''}
      <td class="r mono">${fmtMoney(it.rate, cur.code)}</td>
      <td class="r mono strong">${fmtMoney(it.amount, cur.code)}</td>
    </tr>`).join('');

  const cols = showWeights ? 9 : 7;

  const totalsRows = [
    ['Sub Total', t.subtotal, true],
    t.discount ? [`Discount${doc.charges && doc.charges.discountType === 'percent' ? ` (${fmtNum(doc.charges.discount)}%)` : ''}`, -t.discount] : null,
    t.freight ? ['Freight', t.freight] : null,
    t.insurance ? ['Insurance', t.insurance] : null,
    t.other ? [(doc.charges && doc.charges.otherLabel) || 'Other charges', t.other] : null,
    t.tax ? [`${(doc.charges && doc.charges.taxLabel) || 'Tax'} @ ${fmtNum(t.taxRate)}%`, t.tax] : null,
  ].filter(Boolean).map(([label, val]) => `<div class="tr"><span>${esc(label)}</span><span class="mono">${val < 0 ? '- ' : ''}${fmtMoney(Math.abs(val), cur.code)}</span></div>`).join('');

  const pkg = doc.packages || {};
  const pkgParts = [
    pkg.count ? `${fmtNum(pkg.count, 0)} ${esc(pkg.kind || 'Packages')}` : '',
    (pkg.netWeight || t.netWeight) ? `Net Wt: ${fmtNum(pkg.netWeight || t.netWeight, 3)} KG` : '',
    (pkg.grossWeight || t.grossWeight) ? `Gross Wt: ${fmtNum(pkg.grossWeight || t.grossWeight, 3)} KG` : '',
    pkg.dimensions ? `Dims: ${esc(pkg.dimensions)}` : '',
  ].filter(Boolean);

  const shipmentFields = [
    ['Pre-carriage by', ship.preCarriage], ['Place of receipt', ship.placeOfReceipt], ['Vessel / Flight No.', ship.vessel],
    ['Port of loading', ship.portOfLoading], ['Port of discharge', ship.portOfDischarge], ['Final destination', ship.finalDestination],
    ['Country of origin', ship.countryOfOrigin], ['Country of final destination', ship.countryOfDestination], ['Mode of transport', ship.transportMode],
    ['Container No.', ship.containerNo], ['Seal No.', ship.sealNo], ['Marks & Nos.', ship.marks],
  ].filter(([, v]) => v);

  const hasShipment = shipmentFields.length > 0;

  return `
<div class="doc doc-${esc(template)} ${options.forPdf ? 'for-pdf' : ''}" style="--accent:${esc(accent)}">
  ${stampText && doc.showStatusStamp !== false && status !== 'unpaid' && status !== 'partial' ? `<div class="doc-stamp doc-stamp-${esc(status)}">${stampText}</div>` : ''}
  <div class="doc-topbar"></div>

  <header class="doc-head">
    <div class="brand">
      ${branding.logo ? `<img class="brand-logo" src="${branding.logo}" alt="">` : ''}
      <div class="brand-text">
        <div class="brand-name">${esc(company.name || 'Your Company Name')}</div>
        ${company.tagline ? `<div class="brand-tag">${esc(company.tagline)}</div>` : ''}
        ${company.legalName && company.legalName !== company.name ? `<div class="brand-legal">${esc(company.legalName)}</div>` : ''}
      </div>
    </div>
    <div class="title-block">
      <div class="doc-title">${esc(titleText)}</div>
      <div class="title-meta">
        <div class="tm"><span>Invoice No.</span><strong class="mono">${esc(doc.number || 'AUTO')}</strong></div>
        <div class="tm"><span>Date</span><strong>${fmtDocDate(doc.date)}</strong></div>
        ${doc.dueDate ? `<div class="tm"><span>Due Date</span><strong>${fmtDocDate(doc.dueDate)}</strong></div>` : ''}
        <div class="tm"><span>Currency</span><strong>${esc(cur.code)}</strong></div>
      </div>
    </div>
  </header>

  <section class="exporter-band">
    <div class="eb-col">
      <div class="lbl">Exporter / Seller</div>
      <div class="eb-name">${esc(company.name || '—')}</div>
      <div class="eb-lines">${companyLines.map(esc).join('<br>')}</div>
    </div>
    <div class="eb-col">
      <div class="lbl">Contact</div>
      <div class="eb-lines">${companyContacts.map(esc).join('<br>')}</div>
    </div>
    <div class="eb-col">
      <div class="lbl">Registration</div>
      <div class="eb-lines">${regs.length ? regs.map(esc).join('<br>') : '—'}</div>
    </div>
  </section>

  <section class="parties">
    <div class="card party">
      <div class="lbl">Consignee / Buyer</div>
      <div class="party-name">${esc(consignee.name || 'Customer name')}</div>
      ${consignee.contact ? `<div class="party-line">Attn: ${esc(consignee.contact)}</div>` : ''}
      ${consignee.address ? `<div class="party-line">${lines(consignee.address)}</div>` : ''}
      ${(consignee.city || consignee.country) ? `<div class="party-line">${esc([consignee.city, consignee.country].filter(Boolean).join(', '))}</div>` : ''}
      <div class="party-contacts">
        ${consignee.phone ? `<span>Tel: ${esc(consignee.phone)}</span>` : ''}
        ${consignee.email ? `<span>${esc(consignee.email)}</span>` : ''}
        ${consignee.taxId ? `<span>Tax ID: ${esc(consignee.taxId)}</span>` : ''}
      </div>
      ${notify ? `<div class="notify"><div class="lbl">Notify Party</div><div class="party-line"><strong>${esc(notify.name || '')}</strong></div><div class="party-line">${lines(notify.address)}</div></div>`
        : `<div class="notify"><div class="lbl">Notify Party</div><div class="party-line muted">Same as consignee</div></div>`}
    </div>
    <div class="card details">
      <div class="lbl">Order Details</div>
      ${kv("Buyer's Order No.", doc.buyerOrderNo)}
      ${kv('Order Date', doc.buyerOrderDate ? fmtDocDate(doc.buyerOrderDate) : '', { raw: true })}
      ${kv("Exporter's Ref.", doc.exporterRef)}
      ${kv('Terms of Delivery', ship.incoterm ? `${ship.incoterm}${INCOTERM_LABELS[ship.incoterm] ? ' — ' + INCOTERM_LABELS[ship.incoterm] : ''}${ship.incotermPlace ? ' ' + ship.incotermPlace : ''}` : '')}
      ${kv('Payment Terms', ship.paymentTerms)}
      ${kv('L/C No.', doc.lcNo)}
      ${kv('Prepared by', doc.preparedBy)}
    </div>
  </section>

  ${hasShipment ? `
  <section class="shipment">
    <div class="lbl">Shipment Details</div>
    <div class="ship-grid">
      ${shipmentFields.map(([k, v]) => `<div class="sg"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
    </div>
  </section>` : ''}

  <section class="items">
    <table class="items-table">
      <thead>
        <tr>
          <th class="c" style="width:28px">#</th>
          <th>Description of Goods</th>
          <th class="c" style="width:64px">HS Code</th>
          <th class="r" style="width:58px">Qty</th>
          <th class="c" style="width:42px">Unit</th>
          ${showWeights ? '<th class="r" style="width:58px">Net Wt</th><th class="r" style="width:58px">Gross Wt</th>' : ''}
          <th class="r" style="width:78px">Rate (${esc(cur.code)})</th>
          <th class="r" style="width:92px">Amount (${esc(cur.code)})</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || `<tr><td colspan="${cols}" class="c muted empty">No items added yet</td></tr>`}
      </tbody>
      <tfoot>
        <tr class="tfoot-row">
          <td colspan="3" class="r">Total Quantity</td>
          <td class="r mono strong">${fmtNum(t.totalQty, 3)}</td>
          <td></td>
          ${showWeights ? `<td class="r mono">${t.netWeight ? fmtNum(t.netWeight, 3) : ''}</td><td class="r mono">${t.grossWeight ? fmtNum(t.grossWeight, 3) : ''}</td>` : ''}
          <td class="r">Sub Total</td>
          <td class="r mono strong">${fmtMoney(t.subtotal, cur.code)}</td>
        </tr>
      </tfoot>
    </table>
  </section>

  <section class="summary">
    <div class="summary-left">
      <div class="card words">
        <div class="lbl">Amount in Words</div>
        <div class="words-text">${esc(amountInWords(t.grandTotal, cur.code))}</div>
      </div>
      ${pkgParts.length ? `<div class="card pkgs"><div class="lbl">Packing Summary</div><div class="pkg-row">${pkgParts.map(p => `<span>${p}</span>`).join('')}</div></div>` : ''}
      ${doc.notes ? `<div class="card notes"><div class="lbl">Notes</div><div class="notes-text">${lines(doc.notes)}</div></div>` : ''}
    </div>
    <div class="totals">
      ${totalsRows}
      <div class="tr grand"><span>Grand Total</span><span class="mono">${esc(cur.symbol)} ${fmtMoney(t.grandTotal, cur.code)}</span></div>
      ${status === 'partial' && Number(doc.amountPaid) > 0 ? `<div class="tr"><span>Amount Paid</span><span class="mono">${fmtMoney(doc.amountPaid, cur.code)}</span></div><div class="tr due"><span>Balance Due</span><span class="mono">${fmtMoney(t.grandTotal - Number(doc.amountPaid || 0), cur.code)}</span></div>` : ''}
    </div>
  </section>

  <section class="bottom">
    <div class="bottom-left">
      ${bank && doc.showBank !== false ? `
      <div class="card bank">
        <div class="lbl">Bank Details for Remittance</div>
        <div class="bank-grid">
          ${kv('Beneficiary', bank.beneficiary || company.name)}
          ${kv('Bank Name', bank.bankName)}
          ${kv('Branch', bank.branch)}
          ${kv('Account No.', bank.accountNo)}
          ${kv('IBAN', bank.iban)}
          ${kv('SWIFT / BIC', bank.swift)}
          ${kv('IFSC', bank.ifsc)}
          ${kv('Currency', bank.currency)}
          ${kv('Intermediary Bank', bank.intermediary)}
        </div>
      </div>` : ''}
      ${doc.declaration ? `<div class="declaration"><div class="lbl">Declaration</div><div>${lines(doc.declaration)}</div></div>` : ''}
      ${terms.length ? `<div class="terms"><div class="lbl">Terms & Conditions</div><ol>${terms.map(l => `<li>${esc(l)}</li>`).join('')}</ol></div>` : ''}
    </div>
    <div class="sign">
      <div class="sign-for">For <strong>${esc(company.name || 'Your Company')}</strong></div>
      <div class="sign-art">
        ${branding.stamp && doc.showStamp !== false ? `<img class="stamp-img" src="${branding.stamp}" alt="">` : ''}
        ${branding.signature && doc.showSignature !== false ? `<img class="sign-img" src="${branding.signature}" alt="">` : ''}
      </div>
      <div class="sign-line"></div>
      <div class="sign-name">${esc(branding.signatoryName || '')}</div>
      <div class="sign-title">${esc(branding.signatoryTitle || 'Authorised Signatory')}</div>
    </div>
  </section>

</div>`;
}
