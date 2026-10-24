// Small helpers shared by all modules: escaping, ids, dates, times, formatting.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const pad = n => String(n).padStart(2, '0');
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- dates & times (local, string based) ---------- */
// date: 'YYYY-MM-DD', time: 'HH:MM', datetime: 'YYYY-MM-DDTHH:MM'

export function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function timeStr(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function dtStr(d) {
  return `${dateStr(d)}T${timeStr(d)}`;
}
export const todayStr = () => dateStr(new Date());

export function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
export function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
export function isDT(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s); }

export function parseDate(s) {
  if (!isDate(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function parseDT(s) {
  if (!s || typeof s !== 'string') return null;
  const [d, t = '00:00'] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  if (!y || !m || !dd) return null;
  return new Date(y, m - 1, dd, h || 0, mi || 0);
}
export function combine(date, time) {
  if (!date) return '';
  return `${date}T${isTime(time) ? time : '00:00'}`;
}
export function splitDT(s) {
  if (!isDT(s)) return { date: '', time: '' };
  const [date, time] = s.split('T');
  return { date, time };
}
export function toMin(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}
export function fromMin(m) {
  m = Math.round(m);
  if (m >= 1440) return '23:59';
  if (m < 0) m = 0;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
export function addDays(ds, n) {
  const d = parseDate(ds);
  if (!d) return ds;
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
export function addMinutesDT(s, mins) {
  const d = parseDT(s);
  if (!d) return s;
  return dtStr(new Date(d.getTime() + mins * 60000));
}
export function daysBetween(start, end) {
  const out = [];
  if (!isDate(start)) return out;
  if (!isDate(end) || end < start) end = start;
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 400) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}
export function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }

/* ---------- Polish formatting ---------- */

export const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
export const MONTHS_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
export const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
export const WD_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
export const WD_HEAD = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

export function fmtDate(ds, { weekday = false, year = false, short = false } = {}) {
  const d = parseDate(ds);
  if (!d) return '';
  const month = short ? MONTHS_SHORT[d.getMonth()] : MONTHS_GEN[d.getMonth()];
  let s = `${d.getDate()} ${month}`;
  if (year) s += ` ${d.getFullYear()}`;
  if (weekday) s = `${short ? WD_SHORT[d.getDay()] : WEEKDAYS[d.getDay()]}, ${s}`;
  return s;
}
export function fmtRange(start, end) {
  if (!start) return '';
  if (!end || end === start) return fmtDate(start, { weekday: true, year: true });
  const a = parseDate(start), b = parseDate(end);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${fmtDate(start)} – ${fmtDate(end, { year: true })}`;
}
export function fmtDT(s, { weekday = true } = {}) {
  if (!isDT(s)) return '';
  const { date, time } = splitDT(s);
  return `${fmtDate(date, { weekday, short: true })}, ${time}`;
}
export function fmtDuration(min) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}
export function relTime(target, now = new Date()) {
  const diff = Math.round((target - now) / 60000);
  if (Math.abs(diff) < 1) return 'teraz';
  return diff > 0 ? `za ${fmtDuration(diff)}` : `${fmtDuration(-diff)} temu`;
}
export function countdown(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return { days: d, text: `${pad(hh)}:${pad(mm)}:${pad(ss)}` };
}

/* ---------- text helpers ---------- */

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();
}
/* ---------- money (PLN) ---------- */

// "1 234,50" / "1234.5" / "1 234 zł" -> 1234.5; empty or junk -> null
export function parseAmount(s) {
  const t = String(s ?? '').replace(/[\s zł]/gi, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
export const round2 = n => Math.round(n * 100) / 100;
export const grossOf = (net, vat) => round2(net * (1 + vat / 100));
export const netOf = (gross, vat) => round2(gross / (1 + vat / 100));
export function money(n) {
  return n == null ? '—' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(n);
}

export function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}
export function mapsHref(q) {
  return `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
}
export function initials(name) {
  // skip quoted nicknames and punctuation: Jakub „Jacob” Lewandowski -> JL
  const words = String(name || '').replace(/["„“”«»][^"„“”«»]*["”“«»]/g, ' ')
    .split(/\s+/).map(w => w.replace(/^[^\p{L}\d]+/u, '')).filter(Boolean);
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}
/** Polish plural: plural(1,'sesja','sesje','sesji') -> 'sesja', 3 -> 'sesje', 5 -> 'sesji'. */
export function plural(n, one, few, many) {
  n = Math.abs(Number(n) || 0);
  if (n === 1) return one;
  const d = n % 10, h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}
export const pl = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
}
export function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
export async function dataURLToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}
