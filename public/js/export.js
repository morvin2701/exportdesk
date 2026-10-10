/** Print and PDF export of rendered invoice HTML. */
import { toast } from './ui.js';

let vendorLoaded = null;
function loadVendor() {
  if (vendorLoaded) return vendorLoaded;
  vendorLoaded = Promise.all(['/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js'].map(src => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load PDF library')); document.head.appendChild(s);
  })));
  return vendorLoaded;
}

export function printDoc(html) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  const done = () => { root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 120);
}

const A4_W = 210, A4_H = 297;

/** True when a horizontal pixel row is pure background (white). Light tints like table footers count as content. */
function rowIsBlank(ctx, width, y) {
  const data = ctx.getImageData(0, y, width, 1).data;
  for (let x = 0; x < width; x += 2) {
    const i = x * 4;
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
  }
  return true;
}

/** True when a whole slice has no visible content. */
function sliceIsBlank(ctx, width, y, h) {
  for (let r = y; r < y + h; r += 6) if (!rowIsBlank(ctx, width, r)) return false;
  return true;
}

/**
 * Choose where to cut a page: the lowest gap of blank rows in [minY, maxY] that is thick enough to be a gap
 * BETWEEN blocks (section spacing), so a cut never lands between a heading and its text or inside a table row.
 */
function findCut(ctx, width, minY, maxY) {
  const runs = [];
  let start = -1;
  for (let y = minY; y <= maxY; y++) {
    const blank = rowIsBlank(ctx, width, y);
    if (blank && start < 0) start = y;
    if ((!blank || y === maxY) && start >= 0) { runs.push({ start, end: blank ? y : y - 1 }); start = -1; }
  }
  const pick = minLen => { for (let i = runs.length - 1; i >= 0; i--) { const r = runs[i]; if (r.end - r.start + 1 >= minLen) return Math.floor((r.start + r.end) / 2); } return null; };
  return pick(16) ?? pick(8) ?? maxY;
}

/**
 * Render HTML into an offscreen A4-wide container, rasterize it and paginate:
 *  - content up to ~12% taller than one page is scaled down to fit a single page
 *  - longer content is split only at blank rows (never through a table row), and blank pages are skipped
 */
export async function downloadPdf(html, filename = 'invoice.pdf') {
  await loadVendor();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;background:#fff;z-index:-1;';
  host.innerHTML = html;
  document.body.appendChild(host);
  const docEl = host.querySelector('.doc');
  try {
    await Promise.all(Array.from(host.querySelectorAll('img')).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    await document.fonts.ready;
    const canvas = await window.html2canvas(docEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: docEl.scrollWidth });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pxPerMm = canvas.width / A4_W;
    const pageHeightPx = Math.floor(A4_H * pxPerMm);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Trim trailing blank area (e.g. the empty space under a short invoice) before deciding on pages
    let contentBottom = canvas.height;
    while (contentBottom > pageHeightPx && rowIsBlank(ctx, canvas.width, contentBottom - 1)) contentBottom -= 2;

    if (contentBottom <= pageHeightPx * 1.12) {
      // Single page: scale down slightly if needed so nothing spills over
      const scale = Math.min(1, pageHeightPx / contentBottom);
      const w = A4_W * scale, h = (Math.min(canvas.height, Math.max(contentBottom, pageHeightPx)) / pxPerMm) * scale;
      const slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = Math.min(canvas.height, Math.max(contentBottom, pageHeightPx));
      const sctx = slice.getContext('2d'); sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, 0, slice.width, slice.height, 0, 0, slice.width, slice.height);
      pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', (A4_W - w) / 2, 0, w, h);
    } else {
      let y = 0, pages = 0;
      while (y < contentBottom - 8) {
        let end = Math.min(y + pageHeightPx, contentBottom);
        if (end < contentBottom) end = findCut(ctx, canvas.width, y + Math.floor(pageHeightPx * 0.55), end);
        const sliceH = end - y;
        if (sliceH > 8 && !sliceIsBlank(ctx, canvas.width, y, sliceH)) {
          const slice = document.createElement('canvas');
          slice.width = canvas.width; slice.height = sliceH;
          const sctx = slice.getContext('2d'); sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, slice.width, slice.height);
          sctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          if (pages > 0) pdf.addPage();
          pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4_W, sliceH / pxPerMm);
          pages++;
        }
        y = end;
      }
    }
    pdf.save(filename);
  } catch (e) {
    console.error(e);
    toast('PDF export failed: ' + e.message, 'error');
    throw e;
  } finally {
    host.remove();
  }
}

export function safeFilename(s) {
  return String(s || 'invoice').replace(/[^a-z0-9\-_. ]/gi, '_').replace(/\s+/g, ' ').trim();
}
