// pdf.js loader + text extraction that keeps x/y positions of every text item.

export const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
export const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let loading = null;

export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (!lib) { loading = null; reject(new Error('Biblioteka pdf.js nie załadowała się.')); return; }
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(lib);
      };
      s.onerror = () => {
        loading = null;
        s.remove();
        reject(new Error('Nie udało się pobrać pdf.js. Pierwszy import PDF wymaga internetu (potem działa offline).'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/**
 * Extracts text items with positions.
 * Returns { pages: [{ width, height, items: [{ str, x, y, w, h }] }], numPages }
 * y is measured from the top of the page (baseline).
 */
export async function extractPdf(arrayBuffer, onProgress) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(arrayBuffer.slice(0)); // pdf.js may detach the buffer
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const [, b, c, d, e, f] = it.transform;
        const h = Math.hypot(c, d) || Math.abs(b) || it.height || 10;
        const [x, y] = vp.convertToViewportPoint(e, f);
        items.push({ str: it.str, x, y, w: it.width || it.str.length * h * 0.5, h });
      }
      pages.push({ width: vp.width, height: vp.height, items });
      page.cleanup();
      if (onProgress) onProgress(p, doc.numPages);
    }
  } finally {
    doc.destroy();
  }
  return { pages, numPages: pages.length };
}
