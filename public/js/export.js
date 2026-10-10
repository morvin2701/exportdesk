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
  // Give images a tick to lay out
  setTimeout(() => window.print(), 120);
}

/**
 * Render HTML into an offscreen A4-wide container, rasterize it, and split into A4 pages.
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
    const pageW = 210, pageH = 297;
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const pageHeightPx = Math.floor((pageH / imgW) * canvas.width); // px per page at this scale

    if (imgH <= pageH + 0.5) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgW, imgH);
    } else {
      let y = 0, page = 0;
      while (y < canvas.height) {
        const sliceH = Math.min(pageHeightPx, canvas.height - y);
        const slice = document.createElement('canvas');
        slice.width = canvas.width; slice.height = sliceH;
        const ctx = slice.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        if (page > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgW, (sliceH * imgW) / canvas.width);
        y += sliceH; page++;
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
