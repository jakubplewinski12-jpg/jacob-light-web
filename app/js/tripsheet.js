// "Karta wyjazdowa" – print-quality A4 PDF built from the event data with pdf-lib.
// Inter (OFL) is embedded and subset, so Polish letters work and the file stays small.
// Room plots go in as vectors where possible (PDF pages, Plot Designer scenes).

import { fmtDate, fmtRange, splitDT, isDT, money, grossOf, MONTHS_GEN, pad, pl } from './util.js';
import { getFile } from './store.js';
import { slug } from './export.js';
import { plotKind, readPlotProject, buildScene, renderScene, fixtureSymbol, imageToCanvas, pdfToCanvases, canvasToBlob } from './plotfile.js';

export const PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
export const FONTKIT_URL = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
const FONT_URLS = {
  regular: new URL('../fonts/Inter-Regular.ttf', import.meta.url).href,
  semibold: new URL('../fonts/Inter-SemiBold.ttf', import.meta.url).href
};

/* ---------- lazy libraries ---------- */

const scripts = {};
function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!scripts[url]) {
    scripts[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.crossOrigin = 'anonymous';
      s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(`Biblioteka ${globalName} nie załadowała się.`)));
      s.onerror = () => {
        delete scripts[url];
        s.remove();
        reject(new Error('Nie udało się pobrać biblioteki PDF. Pierwsze generowanie wymaga internetu (potem działa offline).'));
      };
      document.head.appendChild(s);
    });
  }
  return scripts[url];
}
let fontBytes = null;
async function loadFonts() {
  if (fontBytes) return fontBytes;
  const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error('Brak pliku czcionki.'); return new Uint8Array(await r.arrayBuffer()); };
  const [regular, semibold] = await Promise.all([get(FONT_URLS.regular), get(FONT_URLS.semibold)]);
  return (fontBytes = { regular, semibold });
}

/* ---------- constants ---------- */

const MM = 72 / 25.4;
const A4 = [595.28, 841.89];
const M = 18 * MM;               // side margins
const HEAD_Y = 13 * MM;          // header baseline from top
const TOP = 25 * MM;             // content starts this far from the top
const BOTTOM = 20 * MM;          // content ends this far from the bottom

const LOGO_PATHS = [
  'M50 8C27 8 10 26 10 48c0 14 7 23 14 31 5 6 7 11 7 17v6h38v-6c0-6 2-11 7-17 7-8 14-17 14-31C90 26 73 8 50 8Z',
  'M30 116h40M38 129h24M50 28v44M38 38v24M29 50h9M62 38v24M62 50h9'
];

const SECTION_KEYS = [
  ['summary', 'Podsumowanie i harmonogram'],
  ['contacts', 'Kontakty'],
  ['crew', 'Ekipa'],
  ['transport', 'Transport'],
  ['hotel', 'Hotel'],
  ['calls', 'Calle'],
  ['notes', 'Uwagi']
];
export { SECTION_KEYS };

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clean = s => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\t\u00a0\u2007\u202f]/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
const dayLong = d => cap(fmtDate(d, { weekday: true }));
const timeOf = dt => (isDT(dt) ? splitDT(dt).time : '');
const dateOf = dt => (isDT(dt) ? splitDT(dt).date : '');
const fmtDTLong = dt => (isDT(dt) ? `${dayLong(dateOf(dt))}, ${timeOf(dt)}` : '');

export function fileNameFor(ev) {
  return `Karta-wyjazdowa_${slug(ev.name)}_${ev.startDate || ''}.pdf`.replace(/_\.pdf$/, '.pdf');
}

/* ---------- document writer ---------- */

class Writer {
  constructor(L, pdf, fonts, ev) {
    this.L = L; this.pdf = pdf; this.f = fonts; this.ev = ev;
    const { rgb } = L;
    this.c = {
      ink: rgb(0.067, 0.067, 0.067), text: rgb(0.13, 0.13, 0.13), grey: rgb(0.42, 0.42, 0.42), soft: rgb(0.6, 0.6, 0.6),
      rule: rgb(0.8, 0.8, 0.8), hair: rgb(0.88, 0.88, 0.88), accent: rgb(1, 0.498, 0.067), white: rgb(1, 1, 1)
    };
    this.page = null;
  }

  /* text primitives */
  font(bold) { return bold ? this.f.semibold : this.f.regular; }
  width(str, size, bold = false, spacing = 0) {
    const s = clean(str);
    return this.font(bold).widthOfTextAtSize(s, size) + spacing * Math.max(0, [...s].length - 1);
  }
  text(str, x, y, { size = 9, bold = false, color = this.c.text, spacing = 0, align = 'left', page = this.page } = {}) {
    const s = clean(str).replace(/\n/g, ' ');
    if (!s) return;
    const w = this.width(s, size, bold, spacing);
    if (align === 'right') x -= w; else if (align === 'center') x -= w / 2;
    if (spacing) page.pushOperators(this.L.setCharacterSpacing(spacing));
    page.drawText(s, { x, y, size, font: this.font(bold), color });
    if (spacing) page.pushOperators(this.L.setCharacterSpacing(0));
  }
  fit(str, size, bold, maxW) {
    let s = clean(str).replace(/\n/g, ' ');
    if (this.width(s, size, bold) <= maxW) return s;
    while (s.length > 1 && this.width(s + '…', size, bold) > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }
  /** Word wrap using real glyph widths; long words are broken by character. */
  wrap(str, size, bold, maxW) {
    const out = [];
    for (const para of clean(str).split('\n')) {
      const words = para.split(/ +/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (let w of words) {
        const cand = line ? `${line} ${w}` : w;
        if (this.width(cand, size, bold) <= maxW) { line = cand; continue; }
        if (line) out.push(line);
        while (this.width(w, size, bold) > maxW && w.length > 1) {
          let k = w.length - 1;
          while (k > 1 && this.width(w.slice(0, k), size, bold) > maxW) k--;
          out.push(w.slice(0, k));
          w = w.slice(k);
        }
        line = w;
      }
      out.push(line);
    }
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }
  hline(x1, x2, y, color = this.c.hair, thickness = 0.5) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  /* pages */
  newPage(landscape = false) {
    const size = landscape ? [A4[1], A4[0]] : A4;
    this.page = this.pdf.addPage(size);
    this.pw = size[0]; this.ph = size[1];
    this.x0 = M; this.x1 = this.pw - M; this.cw = this.x1 - this.x0;
    this.top = this.ph - TOP; this.bottom = BOTTOM;
    this.y = this.top;
    this.drawHeader();
    return this.page;
  }
  get left() { return this.y - this.bottom; }
  ensure(h) { if (this.y - h < this.bottom) { this.newPage(); return true; } return false; }
  gap(h) { this.y -= h; }

  drawHeader() {
    const p = this.page, c = this.c;
    const yb = this.ph - HEAD_Y;
    const sc = 0.105; // logo: 100 x 140 units -> ~10.5 x 14.7 pt
    for (const d of LOGO_PATHS) {
      p.drawSvgPath(d, { x: this.x0, y: yb + 11.2, scale: sc, borderColor: c.accent, borderWidth: 7.5, borderLineCap: this.L.LineCapStyle.Round });
    }
    const tx = this.x0 + 16;
    this.text('JACOB LIGHT', tx, yb, { size: 7.6, bold: true, color: c.ink, spacing: 0.45 });
    const w1 = this.width('JACOB LIGHT', 7.6, true, 0.45);
    this.text('·  KARTA WYJAZDOWA', tx + w1 + 5, yb, { size: 7.6, color: c.grey, spacing: 0.45 });
    const leftW = w1 + 5 + this.width('·  KARTA WYJAZDOWA', 7.6, false, 0.45) + 16;
    this.text(this.fit(this.ev.name, 8, false, this.cw - leftW - 24), this.x1, yb, { size: 8, color: c.grey, align: 'right' });
    p.drawLine({ start: { x: this.x0, y: yb - 6.5 }, end: { x: this.x1, y: yb - 6.5 }, thickness: 0.8, color: c.accent });
  }

  drawFooters(generated) {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      const { width } = p.getSize();
      const y = 11 * MM;
      p.drawLine({ start: { x: M, y: y + 9 }, end: { x: width - M, y: y + 9 }, thickness: 0.5, color: this.c.rule });
      this.text(`Wygenerowano ${generated} · Event Cal`, M, y, { size: 7, color: this.c.grey, page: p });
      this.text(`Strona ${i + 1} / ${pages.length}`, width - M, y, { size: 7, color: this.c.grey, align: 'right', page: p });
    });
  }

  /* blocks */
  eyebrow(str, { color = this.c.accent, size = 7.2 } = {}) {
    this.text(str.toUpperCase(), this.x0, this.y - size, { size, bold: true, color, spacing: 0.45 });
    this.y -= size + 6;
  }
  section(title, { minAfter = 60, first = false } = {}) {
    const h = 30;
    this.ensure(h + minAfter);
    if (!first && this.y < this.top - 1) this.y -= 16;
    this.text(title.toUpperCase(), this.x0, this.y - 10, { size: 10, bold: true, color: this.c.ink, spacing: 0.5 });
    this.y -= 16;
    this.page.drawLine({ start: { x: this.x0, y: this.y }, end: { x: this.x1, y: this.y }, thickness: 1, color: this.c.accent });
    this.y -= 10;
  }
  subhead(str, { minAfter = 40 } = {}) {
    this.ensure(22 + minAfter);
    this.y -= 4;
    this.text(str, this.x0, this.y - 9.5, { size: 9.5, bold: true, color: this.c.ink });
    this.y -= 17;
  }
  para(str, { size = 9, color = this.c.text, bold = false, lh = 1.45, x = this.x0, w = this.cw } = {}) {
    for (const line of this.wrap(str, size, bold, w)) {
      this.ensure(size * lh + 2);
      this.text(line, x, this.y - size, { size, color, bold });
      this.y -= size * lh;
    }
  }
  /** Label/value pairs in `cols` columns. */
  kv(pairs, cols = 2) {
    pairs = pairs.filter(p => p && p[1]);
    if (!pairs.length) return;
    const gapX = 18, colW = (this.cw - gapX * (cols - 1)) / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const rowPairs = pairs.slice(i, i + cols);
      const blocks = rowPairs.map(([, v]) => this.wrap(v, 9.5, false, colW));
      const h = 11 + Math.max(...blocks.map(b => b.length)) * 13 + 8;
      this.ensure(h);
      rowPairs.forEach(([k], j) => {
        const x = this.x0 + j * (colW + gapX);
        this.text(k.toUpperCase(), x, this.y - 6.5, { size: 6.5, bold: true, color: this.c.grey, spacing: 0.3 });
        blocks[j].forEach((line, li) => this.text(line, x, this.y - 19 - li * 13, { size: 9.5, color: this.c.ink }));
      });
      this.y -= h;
    }
  }
  /** Key times strip: [[label, dt, note]]. */
  keyStrip(items) {
    items = items.filter(i => isDT(i[1]));
    if (!items.length) return;
    const h = 54, w = this.cw / items.length;
    this.ensure(h + 8);
    const yTop = this.y;
    this.hline(this.x0, this.x1, yTop, this.c.ink, 0.8);
    this.hline(this.x0, this.x1, yTop - h, this.c.rule, 0.5);
    items.forEach(([label, dt, note], i) => {
      const x = this.x0 + i * w + (i ? 12 : 0);
      if (i) this.page.drawLine({ start: { x: this.x0 + i * w, y: yTop - 10 }, end: { x: this.x0 + i * w, y: yTop - h + 10 }, thickness: 0.5, color: this.c.hair });
      const iw = w - (i ? 20 : 8);
      this.text(label.toUpperCase(), x, yTop - 14, { size: 6.5, bold: true, color: this.c.accent, spacing: 0.35 });
      this.text(timeOf(dt), x, yTop - 32, { size: 16, bold: true, color: this.c.ink });
      this.text(this.fit(cap(fmtDate(dateOf(dt), { weekday: true, short: true })) + (note ? ` · ${note}` : ''), 7.6, false, iw), x, yTop - 45, { size: 7.6, color: this.c.grey });
    });
    this.y = yTop - h - 6;
  }

  /**
   * Table with wrapped cells, thin rules, header repeated after page breaks.
   * cols: [{ label, w (fraction), align }]; rows: cells = string | { text, sub, bold }
   */
  table(cols, rows, { contTitle = '', size = 8.6 } = {}) {
    if (!rows.length) return;
    const padX = 6, padY = 5.2, lh = size * 1.32, subSize = size - 1.2, subLh = subSize * 1.32;
    const total = cols.reduce((n, c) => n + c.w, 0);
    let x = this.x0;
    const cx = cols.map(c => { const w = (c.w / total) * this.cw; const o = { x, w }; x += w; return o; });
    const headH = 17;
    const drawHead = cont => {
      if (cont && contTitle) {
        this.text(`${contTitle.toUpperCase()} — CIĄG DALSZY`, this.x0, this.y - 7, { size: 6.5, bold: true, color: this.c.soft, spacing: 0.35 });
        this.y -= 14;
      }
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? cx[i].x + cx[i].w - padX : cx[i].x + (i ? padX : 0);
        this.text(c.label.toUpperCase(), tx, this.y - 10.5, { size: 6.5, bold: true, color: this.c.accent, spacing: 0.3, align: c.align === 'right' ? 'right' : 'left' });
      });
      this.y -= headH;
      this.hline(this.x0, this.x1, this.y, this.c.ink, 0.7);
    };
    const layout = row => row.map((cell, i) => {
      const c = typeof cell === 'object' && cell ? cell : { text: cell };
      const innerW = cx[i].w - (i ? padX * 2 : padX);
      return {
        c,
        lines: c.text ? this.wrap(c.text, size, !!c.bold, innerW) : [],
        sub: c.sub ? this.wrap(c.sub, subSize, false, innerW) : []
      };
    });
    const heightOf = cells => padY * 2 + Math.max(lh, ...cells.map(k => k.lines.length * lh + k.sub.length * subLh + (k.lines.length && k.sub.length ? 1 : 0)));
    const maxH = this.top - this.bottom - headH - 30;
    // keep the header together with the first row
    const first = layout(rows[0]);
    let moved = false;
    if (this.y - headH - Math.min(heightOf(first), maxH) < this.bottom) { this.newPage(); moved = true; }
    drawHead(moved);
    rows.forEach((row, ri) => {
      let cells = ri === 0 ? first : layout(row);
      let h = heightOf(cells);
      if (h > maxH) {
        // absurdly long cell: clip it so the row fits one page
        const keep = Math.floor((maxH - padY * 2) / lh);
        cells = cells.map(k => (k.lines.length > keep ? { ...k, lines: [...k.lines.slice(0, keep - 1), k.lines[keep - 1] + ' …'], sub: [] } : k));
        h = heightOf(cells);
      }
      if (this.y - h < this.bottom) { this.newPage(); drawHead(true); }
      cells.forEach((k, i) => {
        const col = cols[i];
        const tx = col.align === 'right' ? cx[i].x + cx[i].w - padX : cx[i].x + (i ? padX : 0);
        if (k.c.draw) k.c.draw(tx, this.y, h);
        let ty = this.y - padY - size + 0.6;
        for (const line of k.lines) {
          this.text(line, tx, ty, { size, bold: !!k.c.bold, color: k.c.muted ? this.c.grey : this.c.ink, align: col.align === 'right' ? 'right' : 'left' });
          ty -= lh;
        }
        if (k.lines.length && k.sub.length) ty -= 1;
        for (const line of k.sub) {
          ty += lh - subLh;
          this.text(line, tx, ty, { size: subSize, color: this.c.grey, align: col.align === 'right' ? 'right' : 'left' });
          ty -= subLh;
        }
      });
      this.y -= h;
      this.hline(this.x0, this.x1, this.y, this.c.hair, 0.5);
    });
    this.y -= 4;
  }
}

/* ---------- pdf-lib backend for the .plot scene renderer ---------- */

function pdfBackend(W, L) {
  const pg = () => W.page; // the table may move on to a new page
  const col = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return W.c.ink;
    const n = parseInt(m[1], 16);
    return L.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  const r2 = v => Math.round(v * 100) / 100;
  return {
    line(x1, y1, x2, y2, o = {}) {
      pg().drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.w || 0.5, color: col(o.color), dashArray: o.dash, lineCap: L.LineCapStyle.Round });
    },
    poly(pts, o = {}) {
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(-y)}`).join(' ') + ' Z';
      pg().drawSvgPath(d, { x: 0, y: 0, color: o.fill ? col(o.fill) : undefined, borderColor: o.stroke ? col(o.stroke) : undefined, borderWidth: o.stroke ? (o.w || 0.5) : 0 });
    },
    circle(x, y, r, o = {}) {
      pg().drawCircle({ x, y, size: r, color: o.fill ? col(o.fill) : undefined, borderColor: o.stroke ? col(o.stroke) : undefined, borderWidth: o.stroke ? (o.w || 0.5) : 0 });
    },
    text(str, x, y, o = {}) {
      const s = clean(str);
      if (!s) return;
      const size = o.size || 7, font = W.font(o.bold);
      const w = font.widthOfTextAtSize(s, size);
      const shift = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
      const a = ((o.rotate || 0) * Math.PI) / 180;
      pg().drawText(s, { x: x + shift * Math.cos(a), y: y + shift * Math.sin(a), size, font, color: col(o.color), rotate: L.degrees(o.rotate || 0) });
    },
    width: (str, size, bold) => W.font(bold).widthOfTextAtSize(clean(str), size)
  };
}

/* ---------- plots ---------- */

/** Loads a room plot into a "placeable": { kind, w, h, pages:[draw(box)] , meta, legend } */
async function preparePlot(W, room) {
  const f = await getFile(room.plot.fileId);
  if (!f) return null;
  const kind = plotKind(f.name, f.type);
  const L = W.L;
  const fromCanvas = async cv => {
    const png = new Uint8Array(await (await canvasToBlob(cv)).arrayBuffer());
    const img = await W.pdf.embedPng(png);
    return { w: img.width, h: img.height, draw: (box, page) => page.drawImage(img, box) };
  };
  const items = [];
  let meta = f.name, scene = null;
  if (kind === 'plot') {
    scene = buildScene(await readPlotProject(f.data));
    const b = scene.bounds;
    const w = b.maxX - b.minX + 1.6, h = b.maxY - b.minY + 1.6;
    items.push({ w, h, vector: true });
    meta = ['Plot Designer', scene.title, scene.venue && `obiekt: ${scene.venue}`, scene.designer && `realizator: ${scene.designer}`].filter(Boolean).join(' · ');
  } else if (kind === 'pdf') {
    try {
      const src = await L.PDFDocument.load(f.data, { ignoreEncryption: true });
      const n = Math.min(src.getPageCount(), 6);
      const embedded = await W.pdf.embedPdf(src, [...Array(n).keys()]);
      for (const e of embedded) items.push({ w: e.width, h: e.height, draw: (box, page) => page.drawPage(e, box) });
      if (src.getPageCount() > n) meta += ` · pokazano ${n} z ${src.getPageCount()} stron`;
    } catch (e) {
      console.warn('Plot PDF nie dał się osadzić jako wektor, rasteryzuję', e);
      const { canvases } = await pdfToCanvases(f.data, { longSide: 2600, maxPages: 6 });
      for (const cv of canvases) items.push(await fromCanvas(cv));
    }
  } else if (kind === 'png' || kind === 'jpg') {
    try {
      const img = kind === 'png' ? await W.pdf.embedPng(f.data) : await W.pdf.embedJpg(f.data);
      items.push({ w: img.width, h: img.height, draw: (box, page) => page.drawImage(img, box) });
    } catch {
      items.push(await fromCanvas(await imageToCanvas(f.data, kind, 2600)));
    }
  } else if (kind) {
    items.push(await fromCanvas(await imageToCanvas(f.data, kind, 2600)));
  }
  if (!items.length) return null;
  return { kind, items, meta, scene };
}

const LEG_HEAD = 17, LEG_ROW = 31;
const legendHeight = rows => (rows ? LEG_HEAD + rows * LEG_ROW + 8 : 0);

/** Fixture key under a Plot Designer drawing: symbol, count, model, type, mode, DMX. */
function drawPlotLegend(W, scene) {
  if (!scene || !scene.legend.length) return;
  const be = pdfBackend(W, W.L);
  const rows = scene.legend.map(g => [
    { text: '', draw: (x, yTop, h) => fixtureSymbol(be, g.type, x + 5, yTop - h / 2, 4.2, g.color) },
    { text: `${g.count} ×`, bold: true },
    { text: g.model, bold: true, sub: g.brand },
    { text: g.typeLabel },
    { text: g.mode ? `${g.mode}${g.ch ? ` · ${g.ch} ch` : ''}` : '—' },
    { text: g.addrs.join(', ') || '—' }
  ]);
  W.table([{ label: '', w: 4 }, { label: 'Szt.', w: 6 }, { label: 'Urządzenie', w: 28 }, { label: 'Typ', w: 10 }, { label: 'Tryb', w: 17 }, { label: 'Adresy DMX', w: 35 }], rows, { size: 8, contTitle: 'Legenda' });
}

/** Places one plot item into the remaining area of the current page. */
function placePlot(W, item, plot, legendRows) {
  const legendH = legendHeight(legendRows);
  const PAD = 12;
  const maxW = W.cw - PAD * 2, maxH = W.y - W.bottom - legendH - 6 - PAD * 2;
  const fontScale = Math.max(1, Math.min(1.5, maxW / 520));
  const footH = item.vector ? 26 * fontScale : 0; // scale bar strip under a .plot drawing
  const k = Math.min(maxW / item.w, (maxH - footH) / item.h);
  const w = item.w * k, h = item.h * k + footH;
  // frame spans the text column and hugs the drawing vertically
  const frame = { x: W.x0, y: W.y - h - PAD * 2, w: W.cw, h: h + PAD * 2 };
  W.page.drawRectangle({ x: frame.x, y: frame.y, width: frame.w, height: frame.h, borderColor: W.c.hair, borderWidth: 0.5 });
  const box = { x: W.x0 + (W.cw - w) / 2, y: frame.y + PAD, w, h };
  if (item.vector) renderScene(plot.scene, pdfBackend(W, W.L), box, { fontScale });
  else item.draw({ x: box.x, y: box.y, width: w, height: h }, W.page);
  W.y = frame.y - 10;
}

/* ---------- content ---------- */

const personName = (ev, id) => ev.crew.find(p => p.id === id)?.name || '';

function summaryPage(W, ev, opt) {
  const t = ev.trip;
  W.eyebrow(`Karta wyjazdowa${ev.type ? ' · ' + ev.type : ''}`);
  for (const line of W.wrap(ev.name, 24, true, W.cw)) {
    W.text(line, W.x0, W.y - 22, { size: 24, bold: true, color: W.c.ink });
    W.y -= 29;
  }
  W.y -= 3;
  W.text(fmtRange(ev.startDate, ev.endDate), W.x0, W.y - 10, { size: 11, color: W.c.grey });
  W.y -= 28;
  W.kv([
    ['Miejsce', ev.venue],
    ['Adres', ev.address],
    ['Klient', ev.client],
    ['Zbiórka', [t.departure.dt && fmtDTLong(t.departure.dt), t.departure.place].filter(Boolean).join(' · ')]
  ]);
  W.gap(6);
  W.keyStrip([['Wyjazd', t.departure.dt], ['Montaż', ev.loadIn], ['Start show', ev.showStart], ['Demontaż', ev.loadOut], ['Powrót', t.ret.dt]]);

  const sched = [
    ['Wyjazd', t.departure.dt, t.departure.place ? `Zbiórka: ${t.departure.place}` : ''],
    ['Przyjazd na miejsce', t.arrival.dt, ev.venue],
    ['Montaż', ev.loadIn, ''],
    ['Start show', ev.showStart, ''],
    ['Koniec show', ev.showEnd, ''],
    ['Demontaż', ev.loadOut, ''],
    ['Powrót', t.ret.dt, t.ret.place ? `Wyjazd z: ${t.ret.place}` : ''],
    ['Przyjazd do bazy', t.ret.arrivalDt, '']
  ].filter(r => isDT(r[1]));
  if (sched.length) {
    W.section('Harmonogram');
    W.table(
      [{ label: 'Etap', w: 24 }, { label: 'Dzień', w: 30 }, { label: 'Godz.', w: 10 }, { label: 'Miejsce / uwagi', w: 36 }],
      sched.map(([label, dt, note]) => [{ text: label, bold: true }, dayLong(dateOf(dt)), { text: timeOf(dt), bold: true }, note || '—']),
      { contTitle: 'Harmonogram' }
    );
  }
  if (opt.sections.contacts && ev.contacts.length) {
    W.section('Kontakty');
    const mail = ev.contacts.some(c => c.email);
    W.table(
      [{ label: 'Imię i nazwisko', w: 28 }, { label: 'Funkcja', w: mail ? 26 : 40 }, { label: 'Telefon', w: mail ? 18 : 32 }, ...(mail ? [{ label: 'E-mail', w: 28 }] : [])],
      ev.contacts.map(c => [{ text: c.name, bold: true }, c.role || '—', c.phone || '—', ...(mail ? [c.email || '—'] : [])]),
      { contTitle: 'Kontakty' }
    );
  }
  if (opt.fee && ev.fee.net != null) {
    W.section('Stawka', { minAfter: 40 });
    W.table(
      [{ label: 'Netto', w: 25, align: 'right' }, { label: 'VAT', w: 15, align: 'right' }, { label: 'Brutto', w: 25, align: 'right' }, { label: 'Status', w: 35, align: 'right' }],
      [[money(ev.fee.net), ev.fee.vat ? `${ev.fee.vat}%` : 'zw.', { text: money(grossOf(ev.fee.net, ev.fee.vat)), bold: true }, ev.fee.paid ? 'Opłacone' : 'Do zapłaty']]
    );
  }
  if (opt.sections.notes && ev.notes) {
    W.section('Notatki', { minAfter: 30 });
    W.para(ev.notes);
  }
}

function crewSection(W, ev) {
  if (!ev.crew.length) return;
  const t = ev.trip;
  const vehOf = id => t.vehicles.find(v => v.driverId === id || v.passengerIds.includes(id));
  const roomOf = id => t.hotelRooms.find(r => r.personIds.includes(id));
  const hasVeh = ev.crew.some(p => vehOf(p.id)), hasRoom = ev.crew.some(p => roomOf(p.id));
  const cols = [{ label: '#', w: 3.5 }, { label: 'Imię i nazwisko', w: 21 }, { label: 'Funkcja', w: 20 }, { label: 'Telefon', w: 14.5 }, { label: 'Sala', w: 17 }];
  if (hasVeh) cols.push({ label: 'Pojazd', w: 17 });
  if (hasRoom) cols.push({ label: 'Pokój', w: 7 });
  W.section(`Ekipa (${ev.crew.length})`);
  W.table(cols, ev.crew.map((p, i) => {
    const v = vehOf(p.id), r = roomOf(p.id);
    const row = [{ text: String(i + 1), muted: true }, { text: p.name, bold: true, sub: p.notes }, p.role || '—', p.phone || '—', ev.rooms.find(x => x.id === p.roomId)?.name || '—'];
    if (hasVeh) row.push(v ? { text: v.name, sub: v.driverId === p.id ? 'kierowca' : '' } : '—');
    if (hasRoom) row.push(r ? r.number || '?' : '—');
    return row;
  }), { contTitle: 'Ekipa' });
}

function transportSection(W, ev) {
  const t = ev.trip;
  if (!t.vehicles.length && !t.departure.dt && !t.ret.dt) return;
  W.section('Transport', { minAfter: Math.min(420, 100 + t.vehicles.length * 40) });
  W.kv([
    ['Wyjazd / zbiórka', [fmtDTLong(t.departure.dt), t.departure.place].filter(Boolean).join(' · ')],
    ['Przyjazd na miejsce', fmtDTLong(t.arrival.dt)],
    ['Powrót', [fmtDTLong(t.ret.dt), t.ret.place && `z: ${t.ret.place}`].filter(Boolean).join(' · ')],
    ['Przyjazd do bazy', fmtDTLong(t.ret.arrivalDt)]
  ]);
  if (t.vehicles.length) {
    W.gap(4);
    W.table(
      [{ label: 'Pojazd', w: 22 }, { label: 'Nr rej.', w: 13 }, { label: 'Kierowca', w: 25 }, { label: 'Pasażerowie', w: 40 }],
      t.vehicles.map(v => {
        const d = ev.crew.find(p => p.id === v.driverId);
        const ps = v.passengerIds.map(id => personName(ev, id)).filter(Boolean);
        return [{ text: v.name, bold: true }, v.plate || '—', d ? { text: d.name, sub: d.phone } : '—', ps.length ? `${ps.join(', ')}` : '—'];
      }),
      { contTitle: 'Transport' }
    );
  }
}

function hotelSection(W, ev) {
  const h = ev.trip.hotel, rooms = ev.trip.hotelRooms;
  if (!h.name && !h.address && !rooms.length) return;
  W.section('Hotel', { minAfter: Math.min(420, 120 + rooms.length * 36) });
  W.kv([['Hotel', h.name], ['Adres', h.address], ['Telefon', h.phone]], 3);
  W.kv([['Zameldowanie', fmtDTLong(h.checkIn)], ['Wymeldowanie', fmtDTLong(h.checkOut)]], 3);
  if (rooms.length) {
    W.gap(4);
    W.table([{ label: 'Pokój', w: 14 }, { label: 'Kto śpi w pokoju', w: 86 }],
      rooms.map(r => [{ text: r.number || '?', bold: true }, r.personIds.map(id => personName(ev, id)).filter(Boolean).join(', ') || '—']),
      { contTitle: 'Hotel' });
  }
}

function callsSection(W, ev) {
  const calls = ev.trip.calls.filter(c => isDT(c.dt));
  if (!calls.length) return;
  W.section('Calle', { minAfter: Math.min(420, 30 + calls.length * 36) });
  W.table([{ label: 'Dzień', w: 26 }, { label: 'Godz.', w: 10 }, { label: 'Co', w: 30 }, { label: 'Kto', w: 34 }],
    calls.map(c => [dayLong(dateOf(c.dt)), { text: timeOf(c.dt), bold: true }, { text: c.label, bold: true },
      c.personIds.length ? c.personIds.map(id => personName(ev, id)).filter(Boolean).join(', ') : { text: 'cała ekipa', muted: true }]),
    { contTitle: 'Calle' });
}

async function roomPages(W, ev, room, idx, total, opt) {
  W.newPage();
  W.eyebrow(`Sala ${idx} / ${total}`);
  for (const line of W.wrap(room.name, 20, true, W.cw)) {
    W.text(line, W.x0, W.y - 18, { size: 20, bold: true, color: W.c.ink });
    W.y -= 24;
  }
  const days = [...new Set(room.sessions.map(s => s.date).filter(Boolean))].sort();
  W.text([pl(room.sessions.length, "sesja", "sesje", "sesji"),
    days.length ? days.map(d => fmtDate(d, { short: true })).join(', ') : '', room.plot && opt.plots ? 'plot w załączeniu' : ''].filter(Boolean).join('  ·  '),
  W.x0, W.y - 8, { size: 8.5, color: W.c.grey });
  W.y -= 14;

  const crew = ev.crew.filter(p => p.roomId === room.id);
  const people = [...crew.map(p => [{ text: p.name, bold: true }, p.role || '—', p.phone || '—', { text: 'Ekipa', muted: true }]),
    ...(room.contacts || []).map(c => [{ text: c.name, bold: true }, c.role || '—', c.phone || '—', { text: 'Sala / obiekt', muted: true }])];
  if (people.length) {
    W.section('Osoby na sali', { first: false });
    W.table([{ label: 'Imię i nazwisko', w: 30 }, { label: 'Funkcja', w: 30 }, { label: 'Telefon', w: 22 }, { label: 'Kto', w: 18 }], people, { contTitle: `${room.name} · osoby` });
  }
  if (room.sessions.length) {
    W.section('Agenda');
    const undated = room.sessions.filter(s => !s.date);
    const groups = days.map(d => [d, room.sessions.filter(s => s.date === d)]);
    if (undated.length) groups.push(['', undated]);
    for (const [d, list] of groups) {
      W.subhead(d ? dayLong(d) : 'Bez daty');
      list.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      W.table([{ label: 'Godzina', w: 14 }, { label: 'Sesja', w: 44 }, { label: 'Cue / uwagi oświetleniowe', w: 42 }],
        list.map(s => [
          { text: s.start ? `${s.start}${s.end ? '–' + s.end : ''}` : '—', bold: true },
          { text: s.title, bold: true, sub: s.speaker },
          s.cues || s.notes ? { text: s.cues || '', sub: s.cues ? s.notes : '', ...(s.cues ? {} : { text: s.notes, muted: true }) } : { text: '—', muted: true }
        ]),
        { contTitle: `${room.name} · ${d ? fmtDate(d, { weekday: true, short: true }) : 'agenda'}` });
    }
  } else if (!people.length) {
    W.para('Brak agendy i przypisanych osób dla tej sali.', { color: W.c.grey });
  }

  if (!(opt.plots && room.plot)) return;
  let plot;
  try {
    plot = await preparePlot(W, room);
  } catch (e) {
    console.warn(e);
    W.section('Plot', { minAfter: 20 });
    W.para(`Nie udało się wczytać planu „${room.plot.name}”: ${e.message || e}`, { color: W.c.grey });
    return;
  }
  if (!plot) return;
  const legendRows = plot.scene ? plot.scene.legend.length : 0;
  plot.items.forEach((item, i) => {
    const landscape = item.w > item.h * 1.08;
    const fresh = A4[landscape ? 0 : 1] - TOP - BOTTOM - 40 - (legendHeight(legendRows));
    const freshW = A4[landscape ? 1 : 0] - 2 * M;
    const kFresh = Math.min(freshW / item.w, fresh / item.h);
    // same page if what is left is close to what a dedicated page would give
    const availH = W.y - W.bottom - 40 - (legendHeight(legendRows));
    const kHere = Math.min(W.cw / item.w, availH / item.h);
    if (i > 0 || kHere < kFresh * 0.9) W.newPage(landscape);
    W.section(i === 0 ? `Plot · ${room.name}` : `Plot · ${room.name} (${i + 1})`, { minAfter: 120 });
    W.text(W.fit(plot.meta, 8, false, W.cw), W.x0, W.y - 6, { size: 8, color: W.c.grey });
    W.y -= 14;
    placePlot(W, item, plot, i === 0 ? legendRows : 0);
    if (i === 0) drawPlotLegend(W, plot.scene);
  });
}

/* ---------- public ---------- */

export function defaultOptions(ev) {
  return {
    sections: Object.fromEntries(SECTION_KEYS.map(([k]) => [k, true])),
    roomIds: ev.rooms.map(r => r.id),
    plots: true,
    fee: false
  };
}

/**
 * Builds the PDF. Returns { bytes: Uint8Array, name, pages }.
 * onProgress(text) is called with short Polish status messages.
 */
export async function buildTripSheet(ev, opt = defaultOptions(ev), onProgress = () => {}) {
  onProgress('Ładuję bibliotekę PDF…');
  const L = await loadScript(PDFLIB_URL, 'PDFLib');
  const fontkit = await loadScript(FONTKIT_URL, 'fontkit');
  const fb = await loadFonts();
  const pdf = await L.PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = {
    regular: await pdf.embedFont(fb.regular, { subset: true }),
    semibold: await pdf.embedFont(fb.semibold, { subset: true })
  };
  pdf.setTitle(`Karta wyjazdowa – ${ev.name}`);
  pdf.setAuthor('Jacob Light');
  pdf.setSubject([ev.venue, fmtRange(ev.startDate, ev.endDate)].filter(Boolean).join(', '));
  pdf.setCreator('Event Cal');
  pdf.setProducer('Event Cal (pdf-lib)');
  pdf.setLanguage('pl-PL');

  const W = new Writer(L, pdf, fonts, ev);
  const s = opt.sections;
  onProgress('Składam stronę główną…');
  W.newPage();
  if (s.summary) summaryPage(W, ev, opt);
  else { W.eyebrow('Karta wyjazdowa'); W.text(W.fit(ev.name, 20, true, W.cw), W.x0, W.y - 18, { size: 20, bold: true, color: W.c.ink }); W.y -= 30; }
  if (s.crew) crewSection(W, ev);
  if (s.transport) transportSection(W, ev);
  if (s.hotel) hotelSection(W, ev);
  if (s.calls) callsSection(W, ev);
  if (s.notes && ev.trip.notes) { W.section('Uwagi do wyjazdu', { minAfter: 30 }); W.para(ev.trip.notes); }

  const rooms = ev.rooms.filter(r => opt.roomIds.includes(r.id));
  for (let i = 0; i < rooms.length; i++) {
    onProgress(`Sala ${i + 1} z ${rooms.length}: ${rooms[i].name}…`);
    await roomPages(W, ev, rooms[i], i + 1, rooms.length, opt);
  }
  const now = new Date();
  W.drawFooters(`${now.getDate()} ${MONTHS_GEN[now.getMonth()]} ${now.getFullYear()}, ${pad(now.getHours())}:${pad(now.getMinutes())}`);
  onProgress('Zapisuję plik…');
  const bytes = await pdf.save();
  return { bytes, name: fileNameFor(ev), pages: pdf.getPageCount() };
}

export { fixtureSymbol };
