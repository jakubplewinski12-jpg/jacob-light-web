// Turns positioned text items (from pdf.js) into lines and cells.
// Item: { str, x, y (top-down baseline), w, h }.

export function groupLines(pages) {
  const out = [];
  pages.forEach((pg, pi) => {
    const items = pg.items
      .filter(i => i.str && i.str.trim())
      .slice()
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const tol = Math.max(2, (it.h || 10) * 0.45);
      let line = null;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
        if (Math.abs(lines[k].y - it.y) <= tol) { line = lines[k]; break; }
      }
      if (!line) { line = { page: pi, y: it.y, h: it.h || 10, items: [] }; lines.push(line); }
      line.items.push(it);
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      l.cells = mergeCells(l.items);
      l.text = l.cells.map(c => c.str).join(' ');
    }
    lines.sort((a, b) => a.y - b.y);
    out.push(...lines.filter(l => l.cells.length));
  });
  return out;
}

/** Merge items that sit close together on a line into "cells" (text runs). */
export function mergeCells(items) {
  const cells = [];
  for (const it of items) {
    const h = it.h || 10;
    const w = it.w || it.str.length * h * 0.5;
    const last = cells[cells.length - 1];
    const gap = last ? it.x - last.x2 : Infinity;
    if (last && gap < h * 0.9) {
      const needSpace = gap > h * 0.12 && !/\s$/.test(last.str) && !/^\s/.test(it.str);
      last.str += (needSpace ? ' ' : '') + it.str;
      last.x2 = Math.max(last.x2, it.x + w);
    } else {
      cells.push({ str: it.str, x: it.x, x2: it.x + w, y: it.y, h });
    }
  }
  for (const c of cells) c.str = c.str.replace(/\s+/g, ' ').trim();
  return cells.filter(c => c.str);
}

/** Plain text with tabs between cells and blank lines between visual blocks. */
export function linesToText(lines) {
  const out = [];
  let prev = null;
  for (const l of lines) {
    if (prev && (l.page !== prev.page || l.y - prev.y > Math.max(l.h, prev.h) * 2.2)) out.push('');
    out.push(l.cells.map(c => c.str).join('\t'));
    prev = l;
  }
  return out.join('\n');
}
