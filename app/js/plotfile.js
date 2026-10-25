// Room stage plots: file type detection, Plot Designer (.plot) reader, a top-view
// renderer that draws the same scene to a canvas (in-app preview) or to a PDF page
// (vector, via a small drawing backend), and raster helpers for images / SVG / PDF.

import { loadPdfJs } from './pdf.js';

export const PLOT_ACCEPT = 'application/pdf,image/*,.svg,.plot';

/** 'pdf' | 'png' | 'jpg' | 'svg' | 'plot' | 'image' | '' */
export function plotKind(name = '', type = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';
  if (ext === 'plot') return 'plot';
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (ext === 'svg' || type === 'image/svg+xml') return 'svg';
  if (ext === 'png' || type === 'image/png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg' || type === 'image/jpeg') return 'jpg';
  if (type.startsWith('image/') || /^(gif|webp|heic|heif|bmp|avif)$/.test(ext)) return 'image';
  return '';
}
export const KIND_LABEL = { pdf: 'PDF', png: 'PNG', jpg: 'JPG', svg: 'SVG', plot: 'Plot Designer', image: 'Obraz' };
export function mimeOf(kind, fallback = '') {
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', plot: 'application/x-plot-designer' }[kind] || fallback || 'application/octet-stream';
}

/* ---------- tiny ZIP reader (stored + deflate) ---------- */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ta przeglądarka nie umie rozpakować pliku .plot (wymagany iOS 16.4+).');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns Map(name -> Uint8Array). */
export async function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('To nie jest archiwum ZIP.');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const method = u16(b, p + 10), size = u32(b, p + 20);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commLen;
    if (u32(b, local) !== 0x04034b50) continue;
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflateRaw(raw));
  }
  return out;
}

/* ---------- mojibake repair (UTF-8 bytes once decoded as cp1250 / cp1252) ---------- */

const revMaps = {};
function revMap(enc) {
  if (revMaps[enc]) return revMaps[enc];
  const m = new Map();
  try {
    const dec = new TextDecoder(enc);
    for (let x = 0x80; x <= 0xff; x++) { const ch = dec.decode(new Uint8Array([x])); if (ch !== '�') m.set(ch, x); }
  } catch { /* encoding not supported */ }
  return (revMaps[enc] = m);
}
function redecode(s, enc) {
  const m = revMap(enc);
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (m.has(ch)) bytes.push(m.get(ch));
    else return null;
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch { return null; }
}
export function fixMojibake(s) {
  if (typeof s !== 'string' || !/[ÂÃÄÅĂĹâ][^\x00-\x7f]/.test(s)) return s;
  for (const enc of ['windows-1250', 'windows-1252']) {
    // whole string first, then sequence by sequence (strings can mix fine and broken parts)
    const whole = redecode(s, enc);
    if (whole && whole !== s) return whole;
    let changed = false;
    const part = s.replace(/â[^\x00-\x7f]{2}|[ÂÃÄÅĂĹ][^\x00-\x7f]/g, seq => {
      const r = redecode(seq, enc);
      if (r && r.length === 1) { changed = true; return r; }
      return seq;
    });
    if (changed) return part;
  }
  return s;
}

/* ---------- Plot Designer project ---------- */

export async function readPlotProject(buf) {
  const b = new Uint8Array(buf);
  let json;
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const files = await unzip(buf);
    const key = files.has('project.json') ? 'project.json' : [...files.keys()].find(k => /\.json$/i.test(k));
    if (!key) throw new Error('W pliku .plot nie ma project.json.');
    json = new TextDecoder().decode(files.get(key));
  } else {
    json = new TextDecoder().decode(b); // older / unpacked export
  }
  let project;
  try { project = JSON.parse(json.replace(/^﻿/, '')); } catch { throw new Error('Plik .plot jest uszkodzony (zły JSON).'); }
  if (!project || !project.scene || !Array.isArray(project.scene.objects)) throw new Error('To nie jest projekt Plot Designer.');
  return project;
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const rad = deg => (num(deg) * Math.PI) / 180;
function trussWidth(type) {
  const m = /(\d+(?:\.\d+)?)/.exec(String(type || ''));
  const v = m ? Number(m[1]) : 30;
  return v >= 10 ? v / 100 : v; // "square-40" -> 0.40 m
}
function rectPts(cx, cy, w, d, yaw) {
  const c = Math.cos(rad(yaw)), s = Math.sin(rad(yaw));
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}
const fmtM = v => String(Math.round(v * 100) / 100).replace('.', ',');
const pad3 = n => String(n).padStart(3, '0');

const TYPE_PL = { spot: 'Spot', wash: 'Wash', beam: 'Beam', profile: 'Profil', par: 'PAR', blinder: 'Blinder', strobe: 'Strob', led: 'LED', hybrid: 'Hybryda', bar: 'Belka LED' };

/** World-space scene (metres, y = depth; negative y = front of stage). */
export function buildScene(project) {
  const sc = project.scene || {};
  const objs = (sc.objects || []).filter(o => o && typeof o === 'object');
  const lib = sc.fixtureLibrary || {};
  const byId = new Map(objs.map(o => [o.id, o]));
  const meta = project.meta || {};
  const out = {
    title: fixMojibake(String(meta.name || '')).trim(),
    venue: fixMojibake(String(meta.venue || '')).trim(),
    designer: fixMojibake(String(meta.lightingDesigner || '')).trim(),
    platforms: [], trusses: [], towers: [], stands: [], props: [], fixtures: [], legend: []
  };
  const pts = [];
  const posOf = o => [num(o.position?.x), num(o.position?.y)];
  for (const o of objs) {
    const name = fixMojibake(String(o.name || ''));
    const [x, y] = posOf(o);
    const yaw = num(o.rotation?.yaw);
    switch (o.kind) {
      case 'platform': {
        const w = Math.max(0.1, num(o.width, 1)), d = Math.max(0.1, num(o.depth, 1));
        const poly = rectPts(x, y, w, d, yaw);
        out.platforms.push({ name, poly, w, d, h: num(o.height), z: num(o.position?.z), cx: x, cy: y });
        pts.push(...poly);
        break;
      }
      case 'truss': {
        const len = Math.max(0.1, num(o.length, 1)), tw = trussWidth(o.trussType);
        const dx = Math.cos(rad(yaw)), dy = Math.sin(rad(yaw));
        out.trusses.push({ id: o.id, name, len, tw, cx: x, cy: y, dx, dy, a: [x - dx * len / 2, y - dy * len / 2], b: [x + dx * len / 2, y + dy * len / 2], poly: rectPts(x, y, len, tw, yaw) });
        pts.push(...rectPts(x, y, len, tw, yaw));
        break;
      }
      case 'tower': {
        const tw = trussWidth(o.trussType);
        const poly = rectPts(x, y, tw, tw, yaw);
        out.towers.push({ name, poly, cx: x, cy: y, h: num(o.height) });
        pts.push(...poly);
        break;
      }
      case 'stand':
        out.stands.push({ name, cx: x, cy: y, r: 0.3, type: String(o.standType || '') });
        pts.push([x - 0.3, y - 0.3], [x + 0.3, y + 0.3]);
        break;
      case 'prop': {
        const la = o.propType === 'line-array';
        const poly = rectPts(x, y, la ? 0.6 : 0.6, la ? 0.5 : 0.6, yaw);
        out.props.push({ name, poly, cx: x, cy: y, type: String(o.propType || '') });
        pts.push(...poly);
        break;
      }
      default: break;
    }
  }
  // fixtures last: mounted ones take their position from the truss / stand they hang on
  for (const o of objs) {
    if (o.kind !== 'fixture') continue;
    let [x, y] = posOf(o);
    const t = o.mount?.targetId ? byId.get(o.mount.targetId) : null;
    if (t) {
      const [tx, ty] = posOf(t);
      if (t.kind === 'truss') {
        const len = num(t.length, 1), yaw = num(t.rotation?.yaw);
        const off = num(o.mount.offset) - len / 2;
        x = tx + Math.cos(rad(yaw)) * off; y = ty + Math.sin(rad(yaw)) * off;
      } else { x = tx; y = ty; }
    }
    const L = lib[o.libraryId] || {};
    const type = String(o.fixtureType || L.shape || 'spot');
    const model = fixMojibake(String(L.model || o.name || 'Urządzenie'));
    const brand = fixMojibake(String(L.brand || ''));
    const mode = String(o.mode || '');
    const ch = (L.modes || []).find(m => m.name === mode)?.channels || null;
    const dmx = o.dmx && Number(o.dmx.address) ? `${num(o.dmx.universe, 1)}.${pad3(num(o.dmx.address))}` : '';
    out.fixtures.push({ x, y, type, color: /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#FF7F11', model, brand, mode, ch, dmx });
    pts.push([x, y]);
  }
  // legend: one row per model + mode
  const groups = new Map();
  for (const f of out.fixtures) {
    const k = `${f.brand}|${f.model}|${f.mode}`;
    if (!groups.has(k)) groups.set(k, { ...f, typeLabel: TYPE_PL[f.type] || f.type, count: 0, addrs: [] });
    const g = groups.get(k);
    g.count++;
    if (f.dmx) g.addrs.push(f.dmx);
  }
  out.legend = [...groups.values()];
  if (!pts.length) pts.push([-1, -1], [1, 1]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  out.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  out.empty = !out.platforms.length && !out.trusses.length && !out.fixtures.length && !out.towers.length;
  return out;
}

/* ---------- renderer (backend-agnostic, page units, y axis up) ---------- */
// backend: line(x1,y1,x2,y2,{w,color,dash}), poly(pts,{fill,stroke,w}), circle(x,y,r,{fill,stroke,w}),
//          text(str,x,y,{size,bold,color,align,rotate}), width(str,size,bold)

const INK = '#141414', GREY = '#6B6B6B', LIGHT = '#F2F2F2', MID = '#E2E2E2';

function niceStep(target) {
  // largest round step whose 4 segments still fit in the target length
  for (const s of [50, 20, 10, 5, 2, 1, 0.5]) if (s * 4 <= target) return s;
  return 0.25;
}

/** Draws the scene into box {x,y,w,h}. Returns { scale } (page units per metre). */
export function renderScene(scene, be, box, { fontScale = 1 } = {}) {
  const fs = v => v * fontScale;
  const footH = fs(26);
  const area = { x: box.x, y: box.y + footH, w: box.w, h: box.h - footH };
  const b = scene.bounds;
  const pad = 0.8;
  const mw = (b.maxX - b.minX) + pad * 2, mh = (b.maxY - b.minY) + pad * 2;
  const s = Math.min(area.w / mw, area.h / mh);
  const ox = area.x + (area.w - mw * s) / 2 - (b.minX - pad) * s;
  const oy = area.y + (area.h - mh * s) / 2 - (b.minY - pad) * s;
  const P = ([x, y]) => [ox + x * s, oy + y * s];
  const lw = v => Math.max(0.25, v);

  // platforms: stage first, raised risers on top
  const plats = [...scene.platforms].sort((a, c) => a.z - c.z);
  for (const p of plats) {
    be.poly(p.poly.map(P), { fill: p.z > 0 ? MID : LIGHT, stroke: INK, w: lw(0.9 * fontScale) });
  }
  for (const p of plats) {
    const [cx, cy] = P([p.cx, p.cy]);
    const sp = p.poly.map(P);
    const bw = Math.max(...sp.map(q => q[0])) - Math.min(...sp.map(q => q[0]));
    const bh = Math.max(...sp.map(q => q[1])) - Math.min(...sp.map(q => q[1]));
    const big = bw > fs(70) && bh > fs(28);
    const label = big ? `${p.name || 'Podest'} · ${fmtM(p.w)} × ${fmtM(p.d)} m${p.h ? ` · h ${fmtM(p.h)} m` : ''}` : (p.name || '');
    if (!label) continue;
    if (big && be.width(label, fs(6.5)) < bw - fs(8)) {
      // stage label sits near the front edge, out of the way of the rig
      const fy = Math.min(...sp.map(q => q[1]));
      be.text(label, cx, fy + fs(6), { size: fs(6.5), color: GREY, align: 'center' });
    } else if (be.width(label, fs(5)) < bw - fs(4) && bh > fs(9)) {
      be.text(label, cx, cy - fs(2), { size: fs(5), color: GREY, align: 'center' });
    }
  }
  for (const p of scene.props) {
    be.poly(p.poly.map(P), { fill: '#CFCFCF', stroke: INK, w: lw(0.6 * fontScale) });
  }
  // trusses: outline + lattice zigzag
  for (const t of scene.trusses) {
    const poly = t.poly.map(P);
    be.poly(poly, { fill: '#FFFFFF', stroke: INK, w: lw(0.7 * fontScale) });
    const [a, b2, c, d] = poly; // a-b one chord, d-c the other
    const lenPx = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
    const n = Math.max(2, Math.round(lenPx / Math.max(fs(5), Math.hypot(d[0] - a[0], d[1] - a[1]) * 1.2)));
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const top = i % 2 ? [d[0] + (c[0] - d[0]) * k, d[1] + (c[1] - d[1]) * k] : [a[0] + (b2[0] - a[0]) * k, a[1] + (b2[1] - a[1]) * k];
      be.line(prev[0], prev[1], top[0], top[1], { w: lw(0.35 * fontScale), color: '#555555' });
      prev = top;
    }
  }
  for (const t of scene.towers) {
    const poly = t.poly.map(P);
    be.poly(poly, { fill: INK, stroke: INK, w: lw(0.6 * fontScale) });
  }
  for (const st of scene.stands) {
    const [x, y] = P([st.cx, st.cy]);
    const r = Math.max(fs(3), st.r * s);
    be.circle(x, y, r, { fill: '#FFFFFF', stroke: INK, w: lw(0.7 * fontScale) });
    be.line(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7, { w: lw(0.5 * fontScale), color: INK });
    be.line(x - r * 0.7, y + r * 0.7, x + r * 0.7, y - r * 0.7, { w: lw(0.5 * fontScale), color: INK });
  }
  // truss names (long ones only), outside the chord
  const midX = (b.minX + b.maxX) / 2;
  const ts = fs(5.2);
  for (const t of scene.trusses) {
    if (!t.name || t.len * s < fs(60)) continue;
    const vertical = Math.abs(t.dy) > Math.abs(t.dx);
    const [cx, cy] = P([t.cx, t.cy]);
    const off = t.tw * s / 2 + fs(2.5);
    const tw = be.width(t.name, ts) + fs(4);
    if (vertical) {
      // outside the rig: left trusses get the label on the left, right ones on the right
      const right = t.cx > midX;
      const x0 = right ? cx + off : cx - off - ts * 1.25;
      be.poly([[x0, cy - tw / 2], [x0 + ts * 1.25, cy - tw / 2], [x0 + ts * 1.25, cy + tw / 2], [x0, cy + tw / 2]], { fill: '#FFFFFF' });
      be.text(t.name, x0 + ts * 1.02, cy, { size: ts, color: GREY, align: 'center', rotate: 90 });
    } else {
      const y0 = cy + off;
      be.poly([[cx - tw / 2, y0], [cx + tw / 2, y0], [cx + tw / 2, y0 + ts * 1.3], [cx - tw / 2, y0 + ts * 1.3]], { fill: '#FFFFFF' });
      be.text(t.name, cx, y0 + ts * 0.32, { size: ts, color: GREY, align: 'center' });
    }
  }
  for (const p of scene.props) {
    if (!p.name) continue;
    const [cx] = P([p.cx, p.cy]);
    const minY = Math.min(...p.poly.map(q => P(q)[1]));
    be.text(p.name, cx, minY - fs(6.5), { size: fs(5), color: GREY, align: 'center' });
  }
  // fixtures
  const r = Math.min(fs(6.5), Math.max(fs(3.6), 0.2 * s));
  for (const f of scene.fixtures) {
    const [x, y] = P([f.x, f.y]);
    fixtureSymbol(be, f.type, x, y, r, f.color, fontScale);
    if (f.dmx) be.text(f.dmx, x, y - r - fs(5.6), { size: fs(5), color: INK, align: 'center' });
  }

  // footer: scale bar left, audience marker centre
  const maxM = area.w / s;
  const step = niceStep(maxM * 0.25);
  const segs = 4;
  const sx = box.x + fs(2), sy = box.y + fs(8);
  for (let i = 0; i < segs; i++) {
    const x0 = sx + i * step * s;
    be.poly([[x0, sy], [x0 + step * s, sy], [x0 + step * s, sy + fs(3.2)], [x0, sy + fs(3.2)]], { fill: i % 2 ? '#FFFFFF' : INK, stroke: INK, w: lw(0.5 * fontScale) });
  }
  be.text('0', sx, sy - fs(7), { size: fs(5.5), color: GREY, align: 'center' });
  be.text(`${String(step * segs).replace('.', ',')} m`, sx + segs * step * s, sy - fs(7), { size: fs(5.5), color: GREY, align: 'center' });
  const front = P([(b.minX + b.maxX) / 2, b.minY - pad]);
  be.text('PRZÓD SCENY · WIDOWNIA', front[0], sy - fs(1), { size: fs(6), color: GREY, align: 'center', bold: true });
  return { scale: s };
}

export function fixtureSymbol(be, type, x, y, r, color, fontScale = 1) {
  const w = Math.max(0.3, 0.7 * fontScale);
  if (type === 'wash') {
    be.circle(x, y, r, { fill: color, stroke: INK, w });
    be.circle(x, y, r * 0.55, { stroke: INK, w: w * 0.7 });
  } else if (type === 'beam') {
    be.poly([[x, y + r * 1.1], [x + r * 1.1, y], [x, y - r * 1.1], [x - r * 1.1, y]], { fill: color, stroke: INK, w });
  } else if (type === 'spot' || type === 'hybrid') {
    be.circle(x, y, r, { fill: color, stroke: INK, w });
    be.circle(x, y, r * 0.28, { fill: INK, stroke: INK, w: w * 0.5 });
  } else {
    be.poly([[x - r, y - r * 0.8], [x + r, y - r * 0.8], [x + r, y + r * 0.8], [x - r, y + r * 0.8]], { fill: color, stroke: INK, w });
  }
}

/* ---------- canvas backend ---------- */

export const CANVAS_FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function canvasBackend(ctx, H) {
  const Y = y => H - y;
  const stroke = o => { if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.w || 1; ctx.stroke(); } };
  return {
    line(x1, y1, x2, y2, o = {}) {
      ctx.beginPath(); ctx.moveTo(x1, Y(y1)); ctx.lineTo(x2, Y(y2));
      ctx.setLineDash(o.dash || []); ctx.lineCap = 'round';
      ctx.strokeStyle = o.color || INK; ctx.lineWidth = o.w || 1; ctx.stroke(); ctx.setLineDash([]);
    },
    poly(pts, o = {}) {
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, Y(y)) : ctx.moveTo(x, Y(y)))); ctx.closePath();
      ctx.lineJoin = 'round';
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      stroke(o);
    },
    circle(x, y, r, o = {}) {
      ctx.beginPath(); ctx.arc(x, Y(y), r, 0, Math.PI * 2);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      stroke(o);
    },
    text(str, x, y, o = {}) {
      ctx.save();
      ctx.font = `${o.bold ? 600 : 400} ${o.size || 8}px ${CANVAS_FONT}`;
      ctx.fillStyle = o.color || INK;
      ctx.textAlign = o.align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.translate(x, Y(y));
      if (o.rotate) ctx.rotate((-o.rotate * Math.PI) / 180);
      ctx.fillText(str, 0, 0);
      ctx.restore();
    },
    width(str, size, bold) {
      ctx.font = `${bold ? 600 : 400} ${size}px ${CANVAS_FONT}`;
      return ctx.measureText(str).width;
    }
  };
}

/** Renders a .plot scene into a new canvas (white paper), fitted in maxW x maxH CSS px. */
export function sceneToCanvas(scene, maxW, maxH, dpr = 2) {
  const b = scene.bounds;
  const aspect = (b.maxX - b.minX + 1.6) / (b.maxY - b.minY + 1.6);
  let w = maxW, h = w / aspect + 26;
  if (h > maxH) { h = maxH; w = Math.min(maxW, (h - 26) * aspect); }
  w = Math.max(200, Math.round(w)); h = Math.max(140, Math.round(h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
  const fontScale = Math.max(0.9, Math.min(1.6, w / 420));
  renderScene(scene, canvasBackend(ctx, h), { x: 10, y: 6, w: w - 20, h: h - 16 }, { fontScale });
  return cv;
}

/* ---------- raster helpers ---------- */

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Nie udało się odczytać obrazu.'));
    img.src = url;
  });
}

/** Intrinsic size of an SVG from width/height or viewBox. */
export function svgSize(text) {
  const tag = (/<svg\b[^>]*>/i.exec(text) || [''])[0];
  const attr = n => (new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag) || [])[1];
  const vb = (attr('viewBox') || '').split(/[\s,]+/).map(Number);
  let w = parseFloat(attr('width')), h = parseFloat(attr('height'));
  if (/%/.test(attr('width') || '')) w = NaN;
  if (/%/.test(attr('height') || '')) h = NaN;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (!(w > 0) && !(h > 0)) { w = vb[2]; h = vb[3]; } else if (!(h > 0)) h = w * vb[3] / vb[2]; else if (!(w > 0)) w = h * vb[2] / vb[3];
  }
  return { w: w > 0 ? w : 800, h: h > 0 ? h : 600 };
}

/** Draws an image file (any browser-readable type incl. SVG) to a canvas. longSide in device px. */
export async function imageToCanvas(data, kind, longSide = 2400, background = '#FFFFFF') {
  let blob, size = null;
  if (kind === 'svg') {
    const text = new TextDecoder().decode(data);
    size = svgSize(text);
    let fixed = text;
    // give the root element explicit pixel dimensions, otherwise some browsers render it at 300x150
    if (!/<svg\b[^>]*\swidth\s*=/i.test(text) || /<svg\b[^>]*\swidth\s*=\s*["'][^"']*%/i.test(text)) {
      fixed = text.replace(/<svg\b/i, `<svg width="${size.w}" height="${size.h}"`);
    }
    blob = new Blob([fixed], { type: 'image/svg+xml' });
  } else {
    blob = new Blob([data], { type: mimeOf(kind, 'image/*') });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const iw = size?.w || img.naturalWidth || 800, ih = size?.h || img.naturalHeight || 600;
    const k = Math.min(longSide / Math.max(iw, ih), kind === 'svg' ? 8 : 1);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(iw * k)); cv.height = Math.max(1, Math.round(ih * k));
    const ctx = cv.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Renders PDF pages (1-based) to canvases with pdf.js. */
export async function pdfToCanvases(data, { longSide = 1600, maxPages = 1 } = {}) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
  const out = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: longSide / Math.max(vp1.width, vp1.height) });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push(cv);
      page.cleanup();
    }
    return { canvases: out, numPages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

export const canvasToBlob = (cv, type = 'image/png', q) => new Promise((res, rej) =>
  cv.toBlob(b => (b ? res(b) : rej(new Error('Nie udało się zapisać obrazu.'))), type, q));

/**
 * Preview canvas(es) for any plot file. stored: { data, name, type }.
 * Returns { canvases, scene?, numPages }.
 */
export async function plotPreview(stored, { longSide = 1400, maxPages = 1, cssW = 360, cssH = 260 } = {}) {
  const kind = plotKind(stored.name, stored.type);
  if (kind === 'plot') {
    const scene = buildScene(await readPlotProject(stored.data));
    return { canvases: [sceneToCanvas(scene, cssW, cssH, longSide / Math.max(cssW, cssH))], scene, numPages: 1 };
  }
  if (kind === 'pdf') return pdfToCanvases(stored.data, { longSide, maxPages });
  if (kind) return { canvases: [await imageToCanvas(stored.data, kind, longSide)], numPages: 1 };
  throw new Error('Nieobsługiwany format pliku.');
}
