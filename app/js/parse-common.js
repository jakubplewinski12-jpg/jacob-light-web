// Shared text recognisers: times, dates, room labels, speaker names, phones.

import { pad, normalize } from './util.js';

/* ---------- times ---------- */

const DATE_MASKS = [/\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g];
// Words that say "the dd.mm next to me is a date, not a time".
export const DATE_WORD_RE = /(poniedzia|wtor|środ|sroda|czwart|piąt|piat|sobot|niedziel|(?:^|[^a-ząćęłńóśźż])(?:pn|wt|śr|sr|cz|pt|sb|nd)\.?(?![a-ząćęłńóśźż])|dzie[nń]|day|dnia|termin|data|zameldowan|wymeldowan|check.?in|check.?out|przyjazd\s+\d|wyjazd\s+\d)/i;
const SHORT_DATE_RE = /(^|[^\d.:])(\d{1,2})\.(\d{1,2})(?![.:]?\d)/g;
/**
 * "12.11" is ambiguous in Polish documents (12 Nov or 12:11). Treat it as a date when
 * it cannot be a time, when the "minutes" are not a multiple of 5 (agendas use round
 * times: 9.30, 10.45) or when the line has a weekday / "dzień" / check-in word.
 */
export function isShortDate(d, m, ctx = '') {
  d = Number(d); m = Number(m);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  if (d > 23) return true;
  if (m % 5 !== 0) return true;
  return DATE_WORD_RE.test(ctx);
}
function maskDates(s) {
  let out = s;
  for (const re of DATE_MASKS) out = out.replace(re, m => ' '.repeat(m.length));
  out = out.replace(SHORT_DATE_RE, (all, pre, d, m) => (isShortDate(d, m, s) ? pre + ' '.repeat(all.length - pre.length) : all));
  return out;
}
const T = '([01]?\\d|2[0-3])[:.]([0-5]\\d)';
const RANGE_RE = new RegExp(`(^|[^\\d:.])(?:od\\s+|godz\\.?\\s*)?${T}\\s*(?:[-–—‒−]{1,2}|do|to|until|>)\\s*${T}(?!\\d)`, 'i');
const SINGLE_RE = new RegExp(`(^|[^\\d:.,])(?:godz\\.?\\s*|g\\.\\s*)?${T}(?![\\d]|[.,:]\\d)`, 'i');

const hm = (h, m) => `${pad(Number(h))}:${m}`;

export function cleanRest(s) {
  return String(s)
    .replace(/\s+/g, ' ')
    .replace(/^[\s|:•·–—\-,;>]+/, '')
    .replace(/[\s|:•·–—\-,;]+$/, '')
    .replace(/^(?:godz\.?|godzina|g\.|od|h)\s+/i, '')
    .trim();
}

/** Finds the first time range (or single time) in s. Returns {start,end,rest} or null. */
export function extractTime(s) {
  if (!s) return null;
  const masked = maskDates(String(s));
  let m = RANGE_RE.exec(masked);
  if (m) {
    const from = m.index + m[1].length;
    const to = m.index + m[0].length;
    return { start: hm(m[2], m[3]), end: hm(m[4], m[5]), rest: cleanRest(s.slice(0, from) + ' ' + s.slice(to)), at: from, to };
  }
  m = SINGLE_RE.exec(masked);
  if (m) {
    const from = m.index + m[1].length;
    const to = m.index + m[0].length;
    return { start: hm(m[2], m[3]), end: '', rest: cleanRest(s.slice(0, from) + ' ' + s.slice(to)), at: from, to };
  }
  return null;
}
export const hasTime = s => !!extractTime(s);

export function normTime(v) {
  if (v == null || v === '') return '';
  const m = String(v).trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?$/);
  if (!m) { const t = extractTime(String(v)); return t ? t.start : ''; }
  const h = Number(m[1]), mi = Number(m[2] || 0);
  if (h > 24 || mi > 59) return '';
  return h === 24 ? '23:59' : `${pad(h)}:${pad(mi)}`;
}

/* ---------- dates ---------- */

const MONTHS = {
  stycznia: 1, styczen: 1, sty: 1, january: 1, jan: 1,
  lutego: 2, luty: 2, lut: 2, february: 2, feb: 2,
  marca: 3, marzec: 3, mar: 3, march: 3,
  kwietnia: 4, kwiecien: 4, kwi: 4, april: 4, apr: 4,
  maja: 5, maj: 5, may: 5,
  czerwca: 6, czerwiec: 6, cze: 6, june: 6, jun: 6,
  lipca: 7, lipiec: 7, lip: 7, july: 7, jul: 7,
  sierpnia: 8, sierpien: 8, sie: 8, august: 8, aug: 8,
  wrzesnia: 9, wrzesien: 9, wrz: 9, september: 9, sep: 9, sept: 9,
  pazdziernika: 10, pazdziernik: 10, paz: 10, october: 10, oct: 10,
  listopada: 11, listopad: 11, lis: 11, november: 11, nov: 11,
  grudnia: 12, grudzien: 12, gru: 12, december: 12, dec: 12
};
const monthOf = w => MONTHS[normalize(w).replace(/\.$/, '')] || 0;

function ymd(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Returns 'YYYY-MM-DD' for the first date in s, or null. */
export function findDate(s, fallbackYear = new Date().getFullYear()) {
  if (!s) return null;
  s = String(s);
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return ymd(m[1], m[2], m[3]);
  // "12–13.11.2026", "12-13 listopada" -> first day of the range
  s = s.replace(/\b(\d{1,2})\s*[–—-]\s*\d{1,2}(?=[./]\d{1,2}[./]\d{2,4}\b|\s+[a-ząćęłńóśźż]{3,})/giu, '$1');
  m = s.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b/);
  if (m) return ymd(m[3], m[2], m[1]);
  // "12.11" without a year (see isShortDate)
  SHORT_DATE_RE.lastIndex = 0;
  let sd;
  while ((sd = SHORT_DATE_RE.exec(s))) {
    if (isShortDate(sd[2], sd[3], s)) return ymd(fallbackYear, sd[3], sd[2]);
  }
  const re = /(\d{1,2})\s+([a-ząćęłńóśźż]{3,13})\.?(?:\s+(\d{4}))?/giu;
  let r;
  while ((r = re.exec(s))) {
    const mo = monthOf(r[2]);
    if (mo) return ymd(r[3] || fallbackYear, mo, r[1]);
  }
  const re2 = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?/gi;
  while ((r = re2.exec(s))) {
    const mo = monthOf(r[1]);
    if (mo) return ymd(r[3] || fallbackYear, mo, r[2]);
  }
  return null;
}
/** "Dzień 2", "Day 1" -> 2 / 1 */
export function findDayIndex(s) {
  const m = String(s || '').match(/(?:^|\s)(?:dzień|dzien|day)\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : 0;
}

/* ---------- rooms ---------- */

export const ROOM_WORDS = 'sala|sali|room|hall|aula|scena|stage|foyer|studio|track|audytorium|auditorium|ścieżka|sciezka|strefa|zone|salon|amfiteatr|kino|arena|lobby|galeria|plenary|plenarna|warsztatownia|workshop room';
const ROOM_RE = new RegExp(`^\\s*(?:${ROOM_WORDS})(?![a-ząćęłńóśźż])`, 'iu');
export const ROOM_WORD_G = new RegExp(`(?:^|\\s)(?:${ROOM_WORDS})(?![a-ząćęłńóśźż])`, 'giu');

export function isRoomLabel(s) {
  s = String(s || '').trim().replace(/:$/, '');
  if (!s || s.length > 45) return false;
  if (s.split(/\s+/).length > 6) return false;
  return ROOM_RE.test(s) && !hasTime(s);
}
export const TIME_HEAD_RE = /^(godz(ina|\.)?|czas|time|hour|h|program|agenda)\s*:?\s*$/i;

/* ---------- people ---------- */

const SPEAKER_PREFIX = /^(prowadz[aą]c[yaei]*|prowadzenie|prowadzi|prowadz[aą]|prelegen(?:t|ci|tka|ci)|speakers?|moderator(?:ka)?|moderacja|panel(?:iści|isci)?|host|go[sś]cie|go[sś][cć]|wyst[eę]puj[aą]c[yay]*|by)\s*:\s*/i;
const TITLE_PREFIX = /^(dr|prof|mgr|inż|inz|hab)\.?\s/i;
const NAME_RE = /^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż'’-]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż'’-]+){1,2}(?:\s*(?:[,(|–—]|\s-\s).{0,80})?$/u;

export function looksLikeSpeaker(t) {
  t = String(t || '').trim();
  if (!t || t.length > 120) return false;
  return SPEAKER_PREFIX.test(t) || TITLE_PREFIX.test(t) || NAME_RE.test(t);
}
export function cleanSpeaker(t) { return String(t || '').trim().replace(SPEAKER_PREFIX, ''); }

export const BREAK_RE = /(?:^|[\s(])(?:przerwa|lunch|obiad|kawa|coffee|break|rejestracja|registration|networking|kolacja|śniadanie|sniadanie|bankiet)/i;

// mobile "600 100 200" / "600-100-200" and landline "22 100 20 30" / "(32) 200 44 44"
export const PHONE_RE = /(?:\+|00)?(?:48[\s-]?)?(?:\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{3}|\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})\b/;

/** Nickname written in quotes inside a name: Jakub „Jacob” Lewandowski -> "Jacob". */
export const NICK_RE = /["„“”«»]([A-ZĄĆĘŁŃÓŚŹŻ][^"„“”«»]{1,20})["”“«»]/u;
export function aliasOf(name) {
  const m = String(name || '').match(NICK_RE);
  return m ? normalize(m[1]) : '';
}
export const PLATE_RE = /\b([A-Z]{1,3})\s?([0-9][0-9A-Z]{2,4}|[A-Z0-9]{4,5})\b/;

/** Split a pasted line into table cells: tabs, 2+ spaces or pipes. */
export function splitCells(line) {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim());
  if (line.includes('|')) return line.split('|').map(c => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
  return line.split(/\s{2,}/).map(c => c.trim());
}
