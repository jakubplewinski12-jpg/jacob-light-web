// Heuristic agenda parser.
//  1) Column parser for PDFs: finds a header row with room names and assigns
//     every text item to a room by its x position (rooms = columns).
//  2) Text parser (pasted text or PDF fallback): tab/2-space tables with a room
//     header, or "Sala X" headings followed by time lines.
// Both produce a raw {rooms:[{name, sessions:[...]}]} that normalizeAgenda() cleans.

import { uid, normalize, isDate, addDays, toMin, fromMin, todayStr } from './util.js';
import {
  extractTime, hasTime, findDate, findDayIndex, isRoomLabel, TIME_HEAD_RE, ROOM_WORD_G,
  looksLikeSpeaker, cleanSpeaker, BREAK_RE, splitCells, normTime, cleanRest
} from './parse-common.js';
import { groupLines, linesToText } from './textlayout.js';

/* ---------- shared builder ---------- */

function makeBuilder(year) {
  const rooms = new Map();
  const b = {
    date: null, day: 0, year,
    ensure(name) {
      const clean = String(name).trim().replace(/:$/, '').replace(/\s+/g, ' ');
      const key = normalize(clean);
      if (!rooms.has(key)) rooms.set(key, { name: clean, sessions: [] });
      return rooms.get(key);
    },
    add(room, start, end, title) {
      const s = { date: b.date, dayIndex: b.day, start, end: end || '', title: (title || '').trim(), speaker: '', notes: '' };
      room.sessions.push(s);
      return s;
    },
    setDate(d) { b.date = d; b.day = 0; },
    setDay(n) { b.day = n; b.date = null; },
    rooms() { return [...rooms.values()]; },
    /** "Sala A Keynote" when "Sala A" is already a known room -> [room, "Keynote"] */
    prefixed(title) {
      const t = normalize(title);
      let best = null;
      for (const r of rooms.values()) {
        const n = normalize(r.name);
        if (n && t.startsWith(n + ' ') && (!best || n.length > normalize(best.name).length)) best = r;
      }
      if (!best) return null;
      const words = best.name.trim().split(/\s+/).length;
      return [best, title.trim().split(/\s+/).slice(words).join(' ').replace(/^[\s:–—|-]+/, '')];
    }
  };
  return b;
}

function appendText(s, t) {
  t = t.trim();
  if (!t) return;
  if (!s.title) { s.title = t; return; }
  if (!s.speaker && looksLikeSpeaker(t)) { s.speaker = cleanSpeaker(t); return; }
  if (!s.speaker && !s.notes && s.title.length < 90 && /^[a-ząćęłńóśźż(„"&+-]/u.test(t)) { s.title += ' ' + t; return; }
  if (!s.speaker && !s.notes && s.title.length < 60 && !/[.!?]$/.test(s.title)) { s.title += ' ' + t; return; }
  s.notes = s.notes ? s.notes + ' ' + t : t;
}

function splitTitleSpeaker(title) {
  const parts = title.split(/\s+[–—|]\s+|\s+-\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (looksLikeSpeaker(last) && !looksLikeSpeaker(parts[0])) {
      parts.pop();
      return { title: parts.join(' – '), speaker: cleanSpeaker(last) };
    }
  }
  const m = title.match(/^(.*?)\s*\(\s*((?:prowadz|moder|prelegen|dr |prof)[^)]*)\)\s*$/i);
  if (m) return { title: m[1], speaker: cleanSpeaker(m[2]) };
  return { title, speaker: '' };
}

/* ---------- 1) column parser (positions) ---------- */

function splitRoomCells(cells) {
  const out = [];
  for (const c of cells) {
    const idx = [];
    ROOM_WORD_G.lastIndex = 0;
    let m;
    while ((m = ROOM_WORD_G.exec(c.str))) idx.push(m.index + (m[0].length - m[0].trimStart().length));
    if (idx.length < 2) { out.push(c); continue; }
    const len = c.str.length || 1;
    idx.forEach((start, k) => {
      const end = k + 1 < idx.length ? idx[k + 1] : len;
      out.push({ ...c, str: c.str.slice(start, end).trim(), x: c.x + (c.x2 - c.x) * start / len, x2: c.x + (c.x2 - c.x) * end / len });
    });
  }
  return out;
}

function detectHeader(line) {
  const cells = splitRoomCells(line.cells);
  const roomCells = cells.filter(c => isRoomLabel(c.str));
  if (roomCells.length >= 2) {
    return { cells: roomCells, rest: cells.filter(c => !roomCells.includes(c)).map(c => c.str).join(' ') };
  }
  if (cells.length >= 3 && TIME_HEAD_RE.test(cells[0].str)
      && cells.slice(1).every(c => c.str.length <= 40 && !hasTime(c.str))) {
    return { cells: cells.slice(1), rest: '' };
  }
  return null;
}

function buildCols(cells) {
  const sorted = cells.slice().sort((a, b) => a.x - b.x);
  const cols = sorted.map(c => ({ name: c.str.replace(/:$/, ''), hx: c.x, hx2: c.x2 }));
  cols.forEach((c, i) => {
    c.left = i === 0 ? -Infinity : (cols[i - 1].hx2 + c.hx) / 2;
  });
  cols.forEach((c, i) => { c.right = i + 1 < cols.length ? cols[i + 1].left : Infinity; });
  const widths = cols.slice(1).map((c, i) => c.hx - cols[i].hx);
  const avg = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 150;
  cols.avg = avg;
  return cols;
}

function parseColumns(lines, year) {
  const B = makeBuilder(year);
  let cols = null;
  let colRooms = [];
  let rowTime = null;
  let current = [];
  let headerAt = -1;
  let found = 0;

  lines.forEach((line, li) => {
    const hdr = detectHeader(line);
    if (hdr) {
      cols = buildCols(hdr.cells);
      colRooms = cols.map(c => B.ensure(c.name));
      current = cols.map(() => null);
      rowTime = null;
      headerAt = li;
      const d = findDate(hdr.rest, year);
      if (d) B.setDate(d);
      return;
    }
    const text = line.text;
    if (!hasTime(text)) {
      const d = findDate(text, year);
      if (d && text.length < 70) { B.setDate(d); rowTime = null; current = cols ? cols.map(() => null) : []; return; }
      const di = findDayIndex(text);
      if (di && text.length < 50) { B.setDay(di); rowTime = null; current = cols ? cols.map(() => null) : []; return; }
    }
    if (!cols) return;

    // bucket raw items by column
    const first = cols[0];
    const buckets = cols.map(() => []);
    const timeBucket = [];
    const spanning = [];
    for (const it of line.items) {
      const x = it.x + 1;
      const x2 = it.x + (it.w || 0);
      if (x < first.hx - 2) {
        if (hasTime(it.str) || x < first.hx - 0.6 * cols.avg) { timeBucket.push(it); continue; }
      }
      // wide item covering several columns (e.g. plenary / break)
      const covered = cols.filter(c => Math.min(x2, c.right === Infinity ? c.hx + cols.avg : c.right) - Math.max(x, c.left === -Infinity ? c.hx - 10 : c.left) > 0.5 * cols.avg);
      if (covered.length >= 2) { spanning.push({ it, cols: covered.map(c => cols.indexOf(c)) }); continue; }
      let idx = cols.findIndex(c => x >= c.left && x < c.right);
      if (idx < 0) idx = 0;
      buckets[idx].push(it);
    }

    const timeText = timeBucket.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    const tt = timeText ? extractTime(timeText) : null;
    const cellTexts = buckets.map(b => b.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());
    const nonEmpty = cellTexts.filter(Boolean).length;

    if (tt) {
      rowTime = { start: tt.start, end: tt.end };
      current = cols.map(() => null);
      if (tt.rest && !nonEmpty && !spanning.length) {
        colRooms.forEach((room, i) => { current[i] = B.add(room, rowTime.start, rowTime.end, tt.rest); found++; });
        return;
      }
    }

    // a lone break / lunch line for the whole row (often centred over a few columns) -> every room
    if (tt && !nonEmpty && spanning.length === 1 && BREAK_RE.test(spanning[0].it.str) && !hasTime(spanning[0].it.str)) {
      const t = spanning[0].it.str.trim();
      colRooms.forEach((room, k) => { current[k] = B.add(room, rowTime.start, rowTime.end, t); found++; });
      return;
    }

    for (const sp of spanning) {
      const t = sp.it.str.trim();
      const own = extractTime(t);
      const time = own || rowTime;
      if (!time) continue;
      for (const i of sp.cols) {
        if (current[i] && !own) appendText(current[i], t);
        else { current[i] = B.add(colRooms[i], time.start, time.end, own ? own.rest : t); found++; }
      }
    }

    // single break text in one column while a new row starts -> applies to every room
    if (tt && nonEmpty === 1) {
      const i = cellTexts.findIndex(Boolean);
      if (BREAK_RE.test(cellTexts[i]) && !hasTime(cellTexts[i])) {
        colRooms.forEach((room, k) => { current[k] = B.add(room, rowTime.start, rowTime.end, cellTexts[i]); found++; });
        return;
      }
    }

    cellTexts.forEach((t, i) => {
      if (!t) return;
      const own = extractTime(t);
      if (own) { current[i] = B.add(colRooms[i], own.start, own.end, own.rest); found++; return; }
      if (current[i]) { appendText(current[i], t); return; }
      if (rowTime) { current[i] = B.add(colRooms[i], rowTime.start, rowTime.end, t); found++; return; }
      // text right under the header without any time: subtitle of the room
      if (li === headerAt + 1 && t.length <= 30) colRooms[i].name += ' – ' + t;
    });
  });

  return found ? { rooms: B.rooms(), endMode: 'global' } : null;
}

/* ---------- 2) text parser ---------- */

const INLINE_ROOM_RE = /^((?:sala|room|hall|aula|scena|stage|studio|foyer|audytorium)\s*[\w\dąćęłńóśźż.-]{0,20})\s*[:–—|-]\s*(.+)$/iu;
const TRAIL_ROOM_RE = /^(.*?)\s*[[(]\s*((?:sala|room|hall|aula|scena|stage|studio|foyer)[^\])]{0,25})[\])]\s*$/i;

function isRoomHeading(line) {
  const t = line.trim();
  if (hasTime(t)) return false;
  if (isRoomLabel(t)) return true;
  return /^[^:]{2,40}:$/.test(t) && t.split(/\s+/).length <= 5 && !looksLikeSpeaker(t.replace(/:$/, '')) && !BREAK_RE.test(t);
}

export function parseAgendaText(text, { year = new Date().getFullYear(), defaultRoom = 'Sala główna' } = {}) {
  const B = makeBuilder(year);
  let curRoom = null;
  let last = null;
  let table = null;      // { cols: [room], timeCol: bool }
  let tableCur = [];
  let rowTime = null;
  let tableRows = 0;

  const lines = String(text || '').replace(/ /g, ' ').split(/\r?\n/);
  for (const raw of lines) {
    // keep trailing tabs: they mark empty table cells
    const line = raw.replace(/[ \r ]+$/, '');
    if (!line.trim()) { last = null; continue; }
    const cells = splitCells(line);
    const filled = cells.filter(Boolean);

    // --- table header?
    const roomCells = filled.filter(c => isRoomLabel(c));
    const explicitHead = TIME_HEAD_RE.test(cells[0] || '');
    const timeHead = explicitHead || cells[0] === '';
    const others = cells.slice(1).filter(Boolean);
    const plainHead = (explicitHead || (cells[0] === '' && !table))
      && others.length >= 2 && others.every(c => !hasTime(c) && c.length < 40 && !looksLikeSpeaker(c));
    if (filled.length >= 2 && (roomCells.length >= 2 || plainHead)) {
      const names = timeHead ? cells.slice(1) : cells;
      table = { cols: names.map(n => (n ? B.ensure(n) : null)), timeCol: timeHead };
      tableCur = [];
      rowTime = null;
      last = null;
      continue;
    }

    const lineTime = extractTime(line);
    if (!lineTime) {
      const d = findDate(line, year);
      if (d && line.length < 70) { B.setDate(d); last = null; tableCur = []; continue; }
      const di = findDayIndex(line);
      if (di && line.length < 50) { B.setDay(di); last = null; tableCur = []; continue; }
    }

    // --- rooms as rows: "Sala A <tab> 09:00–10:00 Otwarcie <tab> 10:00–11:00 Panel"
    if (filled.length >= 2 && isRoomLabel(filled[0]) && filled.slice(1).every(c => hasTime(c))) {
      const room = B.ensure(filled[0]);
      for (const c of filled.slice(1)) {
        const own = extractTime(c);
        const ts = splitTitleSpeaker(own.rest);
        last = B.add(room, own.start, own.end, ts.title);
        last.speaker = ts.speaker;
      }
      curRoom = room;
      continue;
    }

    // --- table rows
    if (table) {
      const firstT = extractTime(cells[0] || '');
      if (filled.length === 1 && firstT && firstT.rest && cells.length === 1) {
        // "10:30–11:00 Przerwa kawowa" spanning all rooms
        tableCur = table.cols.map(room => (room ? B.add(room, firstT.start, firstT.end, firstT.rest) : null));
        tableRows++;
        continue;
      }
      if (cells.length >= 2 && filled.length >= 1) {
        let data = cells;
        let isNewRow = false;
        if (table.timeCol || (firstT && !firstT.rest)) {
          data = cells.slice(1);
          if (firstT) { rowTime = { start: firstT.start, end: firstT.end }; isNewRow = true; tableCur = []; }
        }
        const single = data.filter(Boolean).length === 1;
        const spans = isNewRow && single && table.cols.length > 1
          && ((data.length === 1 && data[0]) || (!line.includes('\t') && BREAK_RE.test(data.find(Boolean))));
        if (spans) {
          const t = data.find(Boolean);
          tableCur = table.cols.map(room => (room ? B.add(room, rowTime.start, rowTime.end, t) : null));
          tableRows++;
          continue;
        }
        data.forEach((c, i) => {
          if (!c) return;
          const room = table.cols[i] || null;
          if (!room) return;
          const own = extractTime(c);
          if (own) { tableCur[i] = B.add(room, own.start, own.end, own.rest); return; }
          if (tableCur[i] && !isNewRow) { appendText(tableCur[i], c); return; }
          if (rowTime) tableCur[i] = B.add(room, rowTime.start, rowTime.end, c);
        });
        tableRows++;
        continue;
      }
      if (isRoomHeading(line)) { table = null; /* fall through to line mode */ }
      else if (!lineTime) continue;
      else table = null;
    }

    // --- line mode
    if (!lineTime && isRoomHeading(line)) {
      curRoom = B.ensure(line.trim());
      last = null;
      continue;
    }
    if (lineTime) {
      let title = lineTime.rest;
      let room = curRoom;
      // split the original text (cleanRest collapses the 2+ spaces that separate cells)
      const rawRest = (line.slice(0, lineTime.at) + '\t' + line.slice(lineTime.to)).replace(/^[\s\t|:–—-]+|[\s\t|]+$/g, '');
      const parts = splitCells(rawRest).map(cleanRest).filter(Boolean);
      const rc = parts.find(p => isRoomLabel(p));
      let m, pre;
      if (rc && parts.length > 1) {
        room = B.ensure(rc);
        title = parts.filter(p => p !== rc).join(' – ');
      } else if ((m = title.match(INLINE_ROOM_RE)) && isRoomLabel(m[1])) {
        room = B.ensure(m[1]); title = m[2];
      } else if ((m = title.match(TRAIL_ROOM_RE))) {
        room = B.ensure(m[2]); title = m[1];
      } else if ((pre = B.prefixed(title)) && pre[1]) {
        room = pre[0]; title = pre[1];
      }
      if (!room) room = curRoom = B.ensure(defaultRoom);
      const ts = splitTitleSpeaker(title.trim());
      last = B.add(room, lineTime.start, lineTime.end, ts.title);
      last.speaker = ts.speaker;
      continue;
    }
    if (last) appendText(last, line.trim());
  }

  return { rooms: B.rooms(), endMode: tableRows ? 'global' : 'room' };
}

/* ---------- public API ---------- */

function countSessions(raw) {
  return (raw?.rooms || []).reduce((n, r) => n + r.sessions.length, 0);
}

/** pages: [{items:[{str,x,y,w,h}]}] from pdf.js. */
export function parseAgendaPages(pages, opts = {}) {
  const year = opts.year || new Date().getFullYear();
  const lines = groupLines(pages);
  const text = linesToText(lines);
  const col = parseColumns(lines, year);
  const txt = parseAgendaText(text, { year });
  const colN = countSessions(col), txtN = countSessions(txt);
  if (col && colN >= 2 && (colN >= txtN * 0.6 || (col.rooms.length > txt.rooms.length && colN >= 4))) {
    return { ...col, method: `kolumny PDF (${col.rooms.length} sal)`, text };
  }
  return { ...txt, method: 'tekst z PDF (nagłówki sal / linie z godzinami)', text };
}

export function parsePastedAgenda(text, opts = {}) {
  const res = parseAgendaText(text, opts);
  return { ...res, method: res.endMode === 'global' ? 'tabela (kolumny = sale)' : 'linie z godzinami', text };
}

/**
 * Cleans raw parser/AI output into app rooms with ids and valid times.
 * Missing end times are inferred from the next start (per room or global grid).
 */
export function normalizeAgenda(raw, { defaultDate = todayStr(), endMode } = {}) {
  endMode = endMode || raw?.endMode || 'room';
  const rooms = [];
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  for (const r of Array.isArray(raw?.rooms) ? raw.rooms : []) {
    const name = clean(r?.name) || `Sala ${rooms.length + 1}`;
    let room = rooms.find(x => normalize(x.name) === normalize(name));
    if (!room) { room = { id: uid('r_'), name, sessions: [] }; rooms.push(room); }
    for (const s of Array.isArray(r?.sessions) ? r.sessions : []) {
      const start = normTime(s?.start);
      if (!start) continue;
      const day = Number(s.dayIndex) || 0;
      const date = isDate(s.date) ? s.date : (day > 0 ? addDays(defaultDate, day - 1) : defaultDate);
      room.sessions.push({
        id: uid('s_'), date, start, end: normTime(s.end),
        title: clean(s.title) || '(bez tytułu)', speaker: clean(s.speaker), notes: clean(s.notes), cues: clean(s.cues)
      });
    }
  }
  // de-duplicate + sort
  for (const room of rooms) {
    const seen = new Set();
    room.sessions = room.sessions.filter(s => {
      const k = `${s.date}|${s.start}|${normalize(s.title)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
  // infer end times
  const globalStarts = {};
  for (const room of rooms) for (const s of room.sessions) (globalStarts[s.date] ||= new Set()).add(toMin(s.start));
  for (const room of rooms) {
    for (const s of room.sessions) {
      if (s.end && toMin(s.end) > toMin(s.start)) continue;
      // "22:00–02:00": a real end after midnight, not a typo (start - end >= 12 h)
      if (s.end && toMin(s.start) - toMin(s.end) >= 720) continue;
      const a = toMin(s.start);
      const pool = endMode === 'global'
        ? [...(globalStarts[s.date] || [])]
        : room.sessions.filter(x => x.date === s.date).map(x => toMin(x.start));
      const next = pool.filter(m => m > a).sort((x, y) => x - y)[0];
      s.end = fromMin(next != null ? next : a + 60);
      s.guessedEnd = true;
    }
  }
  return { rooms };
}
