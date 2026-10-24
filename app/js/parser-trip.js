// Heuristic trip sheet ("karta wyjazdowa") parser.
// Pass 1 collects crew (lines in a crew section, or lines with a phone number).
// Pass 2 classifies the remaining lines: departure / arrival / return, vehicles,
// hotel + rooms, call times, room assignments, notes.
// Output "raw" uses the same shape as the AI schema; normalizeTripImport() resolves
// names to crew ids and builds the app's trip object.

import { uid, normalize, isDate, combine, todayStr, addMinutesDT } from './util.js';
import {
  extractTime, hasTime, findDate, isRoomLabel, PHONE_RE, PLATE_RE, normTime, cleanRest, NICK_RE, aliasOf
} from './parse-common.js';

const L = 'a-ząćęłńóśźż';
const U = 'A-ZĄĆĘŁŃÓŚŹŻ';

const SECTIONS = [
  ['crew', new RegExp(`^(ekipa|crew|sk[łl]ad(\\s+ekipy)?|obsada|zesp[oó][łl]|lista\\s+os[oó]b|technicy|kontakty|osoby)(?![${L}])`, 'iu')],
  ['transport', new RegExp(`^(transport|logistyka|przejazd|dojazd|auta|pojazdy|samochody|busy|wyjazd\\s*/\\s*powr[oó]t)(?![${L}])`, 'iu')],
  ['hotel', new RegExp(`^(hotel|nocleg|noclegi|zakwaterowanie|pokoje|accommodation)(?![${L}])`, 'iu')],
  ['calls', new RegExp(`^(harmonogram|plan\\s+dnia|plan|calle?|call\\s*times?|godziny|grafik|schedule|timeline|rozk[łl]ad)(?![${L}])`, 'iu')],
  ['rooms', new RegExp(`^(przydzia[łl](\\s+(do\\s+)?sal)?|obsada\\s+sal|stanowiska|sale)(?![${L}])`, 'iu')],
  ['notes', new RegExp(`^(uwagi|notatki|informacje|info|notes|wa[żz]ne)(?![${L}])`, 'iu')]
];

const ROLE_RE = new RegExp(`(realizator[${L}]*(?:\\s+(?:o[sś]wietlenia|d[zź]wi[eę]ku|wizji|wideo))?|o[sś]wietleniow[${L}]*|technik[${L}]*(?:\\s+[${L}]+)?|operator[${L}]*(?:\\s+[${L}]+)?|light\\s*designer|lighting\\s*designer|\\bLD\\b|kierownik[${L}]*(?:\\s+[${L}]+)?|koordynator[${L}]*|stage\\s*manager|\\bSM\\b|rigger[${L}]*|akustyk[${L}]*|d[zź]wi[eę]kowiec|multimedia[${L}]*|projekcj[${L}]*|kierowca|elektryk[${L}]*|producent[${L}]*|pomocnik|helper|monta[zż]ysta|scenograf[${L}]*|inspicjent[${L}]*|\\bFOH\\b|kamerzysta|grafik|asystent[${L}]*|szef[${L}]*(?:\\s+[${L}]+)?|backliner|stagehand)`, 'iu');
const NAME_RE = new RegExp(`[${U}][${L}'’-]+(?:\\s+[${U}][${L}'’-]+){0,2}`, 'u');
const VEH_RE = new RegExp(`(?:^|[^${L}])(bus[${L}]*|auto|samoch[oó]d[${L}]*|van|sprinter|ducato|master|crafter|vito|transit|ci[eę][żz]ar[oó]wk[${L}]*|tir|truck|osob[oó]wk[${L}]*|furgon[${L}]*|dostawcz[${L}]*|pojazd[${L}]*|naczep[${L}]*|laweta)(?![${L}])`, 'iu');
const DEP_RE = /(wyjazd|zbi[oó]rka|odjazd|departure|wyruszamy|start\s+trasy)/i;
const ARR_RE = /(przyjazd|dojazd\s+na\s+miejsce|arrival|na\s+miejscu|dotarcie)/i;
const RET_RE = /(powr[oó]t|return|zjazd\s+do\s+bazy|wyjazd\s+z\s+obiektu|odjazd\s+do\s+domu)/i;
const CI_RE = /(zameldowanie|check-?\s?in)/i;
const CO_RE = /(wymeldowanie|check-?\s?out)/i;
const HOTEL_RE = new RegExp(`(?:^|[^${L}])(hotel|apartament[${L}]*|pensjonat|motel|hostel|zajazd|nocleg[${L}]*)(?![${L}])`, 'iu');
const HROOM_RE = /\b(?:pok(?:[oó]j)?\.?|room|nr\.?)\s*(\d{1,4}[a-z]?)\b/i;
const ADDR_RE = /(?:^|\s)(ul\.|al\.|pl\.|ulica|aleja|os\.|street|str\.)\s/i;
const CALL_RE = /(call|zbi[oó]rka|pr[oó]ba|monta[zż]|demonta[zż]|roz[łl]adunek|za[łl]adunek|soundcheck|gotowo[sś][cć]|odprawa|briefing|obiad|kolacja|[sś]niadanie|start|koniec|load.?in|load.?out|show|pokaz|otwarcie|programowanie|ustawianie|focus)/i;
const ALL_RE = /(wszyscy|ca[łl]a\s+ekipa|ca[łl]y\s+zesp[oó][łl]|all\s+crew|everyone|ekipa)/i;
const DRIVER_RE = new RegExp(`(?:kierowca|kier\\.?|prowadzi|driver)\\s*:?\\s*([${U}][${L}'’-]+(?:\\s+[${U}][${L}'’-]+)?)`, 'u');
const DRIVER_PAREN_RE = new RegExp(`([${U}][${L}'’-]+(?:\\s+[${U}][${L}'’-]+)?)\\s*\\((?:kier|kierowca|driver|prowadzi)`, 'u');
const LIST_RE = /(?:jad[aą]|pasa[żz]erowie|sk[łl]ad|osoby|ekipa|w\s+aucie|passengers)\s*:\s*(.+)$/i;

function sectionOf(line) {
  const t = line.trim().replace(/^[#*\-–•\s]+/, '');
  if (t.length > 60 || hasTime(t)) return null;
  for (const [key, re] of SECTIONS) {
    if (re.test(t)) {
      const rest = t.replace(re, '').replace(/^[\s:–—\-/]+/, '').trim();
      return { key, rest };
    }
  }
  return null;
}

function splitParts(s) {
  return s.split(/\s*[–—|;,\t()]\s*|\s+-\s+|\s*:\s+|\s*\/\s*/).map(x => x.trim()).filter(Boolean);
}

function parseCrewLine(line) {
  const phoneM = line.match(PHONE_RE);
  const phone = phoneM ? phoneM[0].trim() : '';
  let rest = phoneM ? line.replace(phoneM[0], ' ') : line;
  rest = rest
    .replace(/\b(tel\.?|telefon|kom\.?|mob\.?|phone|nr\s+tel\.?)\s*:?/gi, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, ' ')
    .replace(/^\s*(\d+[.)]|[-•*·])\s*/, '');
  // nickname: Jakub "Jacob" Lewandowski – keep it in the name so "Jacob" matches later
  const nick = rest.match(NICK_RE);
  if (nick) rest = rest.replace(nick[0], ' ');
  const parts = splitParts(rest);
  let name = '', role = '', room = '';
  for (const p of parts) {
    if (!room && isRoomLabel(p)) { room = p; continue; }
    const rm = p.match(ROLE_RE);
    if (!name) {
      const nm = p.match(NAME_RE);
      if (nm && nm.index === 0 && !(rm && rm.index === 0)) {
        name = nm[0].trim().replace(/\s+/g, ' ');
        const after = p.slice(nm[0].length).trim();
        if (after && !role) role = after;
        continue;
      }
    }
    if (!role && (rm || name)) { role = p; continue; }
  }
  // "Sala B" written inside a role part
  if (!room) {
    const m = rest.match(/((?:sala|room|hall|aula|scena|stage|studio|foyer)\s*[\w\dąćęłńóśźż-]{0,15})/i);
    if (m && isRoomLabel(m[1])) { room = m[1].trim(); role = role.replace(m[1], '').replace(/[\s,–-]+$/, '').trim(); }
  }
  if (nick && name) {
    const w = name.split(' ');
    name = w.length > 1 ? `${w[0]} „${nick[1].trim()}” ${w.slice(1).join(' ')}` : `${name} „${nick[1].trim()}”`;
  }
  return { name, role, phone, room };
}

/** Find crew names mentioned in a line (full name, unique first name, or surname). */
function matchPeople(text, crew) {
  const hay = ' ' + normalize(text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const hits = [];
  const plain = n => normalize(String(n || '').replace(NICK_RE, ' ')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const p of crew) {
    const full = plain(p.name);
    if (!full) continue;
    const parts = full.split(' ');
    let idx = hay.indexOf(' ' + full + ' ');
    if (idx < 0 && parts.length > 1) {
      const last = parts[parts.length - 1];
      if (last.length >= 4) idx = hay.indexOf(' ' + last + ' ');
    }
    if (idx < 0) {
      const first = parts[0];
      const unique = crew.filter(q => plain(q.name).split(' ')[0] === first).length === 1;
      if (first.length >= 3 && unique) idx = hay.indexOf(' ' + first + ' ');
    }
    const nick = aliasOf(p.name).replace(/[^a-z0-9 ]/g, ' ').trim();
    if (idx < 0 && nick.length >= 2) idx = hay.indexOf(' ' + nick + ' ');
    if (idx >= 0) hits.push({ name: p.name, idx });
  }
  return hits.sort((a, b) => a.idx - b.idx).map(h => h.name).filter((n, i, a) => a.indexOf(n) === i);
}

/** Names written as a comma list ("Jan Kowalski, Ola, Piotr N.") */
function nameList(s) {
  return s.split(/\s*[,;+&]\s*|\s+i\s+|\s+oraz\s+/)
    .map(x => x.replace(/\(.*?\)/g, '').trim())
    .filter(x => new RegExp(`^[${U}]`, 'u').test(x) && x.length <= 40);
}

function placeOf(line, t) {
  let s = t ? t.rest : line;
  s = s.replace(DEP_RE, ' ').replace(RET_RE, ' ').replace(ARR_RE, ' ')
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, ' ')
    .replace(/\b(godz\.?|o\s+godz\.?|ok\.)\s*/gi, ' ');
  return cleanRest(s.replace(/[([]\s*[)\]]/g, ' ')).replace(/^(o|z|ze|:)\s+/i, '').trim();
}

export function parseTripText(text, { year = new Date().getFullYear() } = {}) {
  const lines = String(text || '').replace(/ /g, ' ').split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  const raw = {
    crew: [], departure: null, arrival: null, return: null, vehicles: [],
    hotel: { name: '', address: '', phone: '', checkInDate: '', checkInTime: '', checkOutDate: '', checkOutTime: '' },
    hotelRooms: [], calls: [], notes: ''
  };
  const notes = [];
  const used = new Set();

  // ---- pass 1: crew
  let section = null;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const sec = sectionOf(line);
    if (sec) { section = sec.key; if (!sec.rest) { used.add(i); return; } }
    const hasPhone = PHONE_RE.test(line);
    const timeless = !hasTime(line.replace(PHONE_RE, ' '));
    const looksOther = HOTEL_RE.test(line) || VEH_RE.test(line) || HROOM_RE.test(line);
    if ((section === 'crew' && timeless && !looksOther) || (hasPhone && timeless && !looksOther)) {
      const c = parseCrewLine(sec && sec.rest ? sec.rest : line);
      if (c.name && (section === 'crew' || c.name.split(' ').length >= 2)) {
        if (!raw.crew.some(x => normalize(x.name) === normalize(c.name))) raw.crew.push(c);
        used.add(i);
      }
    }
  });

  // ---- pass 2: everything else
  section = null;
  let curDate = null;
  let lastVehicle = null;
  const crewNames = () => raw.crew.map(c => ({ name: c.name }));

  lines.forEach((line0, i) => {
    let line = line0.trim();
    if (!line) { lastVehicle = null; return; }
    const sec = sectionOf(line);
    if (sec) {
      section = sec.key;
      lastVehicle = null;
      if (!sec.rest) return;
      if (sec.key !== 'hotel') line = sec.rest;
    }
    if (used.has(i)) return;

    // "zameldowanie 11.11 od 14:00, wymeldowanie 13.11 do 11:00" – two facts in one line
    if (CI_RE.test(line) && CO_RE.test(line)) {
      const k = line.search(CO_RE);
      const parts = k > 0 ? [line.slice(0, k), line.slice(k)] : [line];
      let hit = false;
      for (const part of parts) {
        const pt = extractTime(part);
        if (!pt) continue;
        const pd = findDate(part, year) || curDate || '';
        if (CO_RE.test(part)) { raw.hotel.checkOutDate = pd; raw.hotel.checkOutTime = pt.start; }
        else { raw.hotel.checkInDate = pd; raw.hotel.checkInTime = pt.start; }
        hit = true;
      }
      if (hit) return;
    }

    const lineDate = findDate(line, year);
    const t = extractTime(line);
    if (!t && lineDate && line.length < 50) { curDate = lineDate; return; }
    const date = lineDate || curDate || '';
    // a dated line with a time ("11.11 zbiórka 7:30") also sets the day for the next lines
    if (lineDate && t && !CI_RE.test(line) && !CO_RE.test(line)) curDate = lineDate;

    // departure / arrival / return (need a time)
    if (t && RET_RE.test(line)) {
      raw.return = { date, time: t.start, place: placeOf(line, t) };
      return;
    }
    if (t && DEP_RE.test(line) && !raw.departure) {
      raw.departure = { date, time: t.start, place: placeOf(line, t) };
      if (t.end) raw.arrival = { date, time: t.end };
      const people = matchPeople(line, crewNames());
      if (people.length && VEH_RE.test(line)) {
        raw.vehicles.push({ name: (line.match(VEH_RE)?.[1] || 'Pojazd'), plate: '', driver: '', passengers: people });
      }
      return;
    }
    if (t && ARR_RE.test(line) && !raw.arrival) { raw.arrival = { date, time: t.start }; return; }
    if (t && CI_RE.test(line)) { raw.hotel.checkInDate = date; raw.hotel.checkInTime = t.start; return; }
    if (t && CO_RE.test(line)) { raw.hotel.checkOutDate = date; raw.hotel.checkOutTime = t.start; return; }

    // hotel room: "Pokój 214: Jan Kowalski, Piotr Nowak"
    const hr = line.match(HROOM_RE);
    if (hr && (section === 'hotel' || /pok/i.test(hr[0])) && !t) {
      let people = matchPeople(line, crewNames());
      if (!people.length) {
        const after = line.slice(hr.index + hr[0].length).replace(/^[\s:–—-]+/, '');
        people = nameList(after);
      }
      raw.hotelRooms.push({ number: hr[1], people });
      return;
    }

    // vehicle
    const vm = line.match(VEH_RE);
    if (vm && !t) {
      const plateM = [...line.matchAll(new RegExp(PLATE_RE.source, 'g'))].find(m => /\d/.test(m[0]) && /[A-Z]/.test(m[1]));
      let name = line.split(/\s*[:(–—]\s*|\s+-\s+/)[0].trim();
      if (name.length > 32 || !VEH_RE.test(name)) name = vm[1].charAt(0).toUpperCase() + vm[1].slice(1);
      if (plateM) name = name.replace(plateM[0], '').replace(/[\s,]+$/, '').trim() || name;
      const dm = line.match(DRIVER_RE) || line.match(DRIVER_PAREN_RE);
      const driver = dm ? dm[1].trim() : '';
      let passengers = matchPeople(line, crewNames());
      const lm = line.match(LIST_RE);
      if (!passengers.length && lm) passengers = nameList(lm[1]);
      if (!passengers.length && !lm) {
        const after = line.split(/:\s+/).slice(1).join(': ');
        if (after) passengers = nameList(after.replace(DRIVER_RE, ''));
      }
      const dn = normalize(driver);
      passengers = passengers.filter(n => !dn || (normalize(n) !== dn && !normalize(n).startsWith(dn + ' ')));
      lastVehicle = { name, plate: plateM ? plateM[0] : '', driver, passengers };
      raw.vehicles.push(lastVehicle);
      return;
    }
    // continuation of a vehicle block
    if (lastVehicle && !t) {
      const dm = line.match(DRIVER_RE);
      if (dm) { lastVehicle.driver = dm[1].trim(); return; }
      const people = matchPeople(line, crewNames());
      const lm = line.match(LIST_RE);
      const add = people.length ? people : (lm ? nameList(lm[1]) : []);
      if (add.length) {
        for (const n of add) if (!lastVehicle.passengers.includes(n) && n !== lastVehicle.driver) lastVehicle.passengers.push(n);
        return;
      }
    }

    // hotel details
    if (HOTEL_RE.test(line) && !t && !raw.hotel.name) {
      const phoneM = line.match(PHONE_RE);
      if (phoneM) raw.hotel.phone = phoneM[0].trim();
      let s = line.replace(PHONE_RE, ' ').replace(/^(nocleg[a-ząćęłńóśźż]*|zakwaterowanie)\s*[:–-]?\s*/i, '');
      const parts = s.split(/\s*,\s*/);
      raw.hotel.name = cleanRest(parts.shift() || '');
      const addr = parts.join(', ').replace(/\b(tel\.?|telefon)\s*:?\s*$/i, '').trim();
      if (addr) raw.hotel.address = cleanRest(addr);
      return;
    }
    if (section === 'hotel' && !t) {
      if (ADDR_RE.test(line) && !raw.hotel.address) { raw.hotel.address = cleanRest(line.replace(/^adres\s*:?/i, '')); return; }
      if (PHONE_RE.test(line) && !raw.hotel.phone) { raw.hotel.phone = line.match(PHONE_RE)[0].trim(); return; }
    }

    // room assignment: "Sala A: Tomek Wrona, Ola Krawczyk"
    const roomM = line.match(/^((?:sala|room|hall|aula|scena|stage|studio|foyer|audytorium)\s*[\w\dąćęłńóśźż.-]{0,20})\s*[:–—-]\s*(.+)$/iu);
    if (roomM && isRoomLabel(roomM[1]) && !t) {
      const people = matchPeople(roomM[2], crewNames());
      for (const n of people) {
        const c = raw.crew.find(x => x.name === n);
        if (c) c.room = roomM[1].trim();
      }
      if (people.length) return;
    }

    // call times
    if (t && (CALL_RE.test(line) || section === 'calls' || section === 'transport')) {
      const everyone = ALL_RE.test(line);
      const people = everyone ? [] : matchPeople(line, crewNames());
      let label = t.rest.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, ' ');
      label = cleanRest(label) || 'Call';
      raw.calls.push({ date, time: t.start, label: label.slice(0, 90), people });
      return;
    }
    if (t && !raw.departure && /wyjazd|odjazd/i.test(line)) {
      raw.departure = { date, time: t.start, place: placeOf(line, t) };
      return;
    }

    if (section === 'notes' || line.length > 3) notes.push(line);
  });

  raw.notes = notes.join('\n');
  return raw;
}

/* ---------- normalisation into app objects ---------- */

/**
 * raw: heuristic or AI output. ev: target event (for existing crew/rooms).
 * Returns { crew, trip } where crew members may carry _roomName for unmatched rooms.
 */
export function normalizeTripImport(raw, ev, defaultDate = todayStr()) {
  raw = raw || {};
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const crew = (ev?.crew || []).map(p => ({ ...p }));
  const rooms = ev?.rooms || [];

  const find = name => {
    const n = normalize(name);
    if (!n) return null;
    let p = crew.find(c => normalize(c.name) === n);
    if (p) return p;
    // nickname ("Jacob" for Jakub „Jacob” Lewandowski), or the name without the nickname
    p = crew.find(c => aliasOf(c.name) && aliasOf(c.name) === n)
      || crew.find(c => normalize(String(c.name).replace(NICK_RE, ' ')).replace(/\s+/g, ' ').trim() === n);
    if (p) return p;
    const parts = n.split(' ');
    if (parts.length >= 2) {
      p = crew.find(c => { const q = normalize(c.name).split(' '); return q[0] === parts[0] && q[q.length - 1] === parts[parts.length - 1]; });
      if (p) return p;
      p = crew.find(c => normalize(c.name).split(' ').length === 1 && normalize(c.name) === parts[0]);
      if (p) { p.name = clean(name); return p; }
    } else {
      const same = crew.filter(c => normalize(c.name).split(' ')[0] === n);
      if (same.length === 1) return same[0];
    }
    return null;
  };
  const findOrAdd = name => {
    name = clean(name).replace(/\(.*?\)/g, '').trim();
    if (!name || name.length > 50) return null;
    let p = find(name);
    if (!p) { p = { id: uid('p_'), name, role: '', phone: '', roomId: '', notes: '' }; crew.push(p); }
    return p;
  };
  const matchRoom = name => {
    const n = normalize(name);
    if (!n) return null;
    return rooms.find(r => normalize(r.name) === n)
      || rooms.find(r => normalize(r.name).startsWith(n) || n.startsWith(normalize(r.name)))
      || null;
  };

  for (const c of Array.isArray(raw.crew) ? raw.crew : []) {
    const p = findOrAdd(c?.name);
    if (!p) continue;
    if (c.role) p.role = clean(c.role);
    if (c.phone) p.phone = clean(c.phone);
    if (c.room) {
      const r = matchRoom(c.room);
      if (r) { p.roomId = r.id; delete p._roomName; } else p._roomName = clean(c.room);
    }
  }

  const dt = (date, time) => {
    const tm = normTime(time);
    if (!tm) return '';
    return combine(isDate(date) ? date : defaultDate, tm);
  };
  const ids = names => (Array.isArray(names) ? names : []).map(n => findOrAdd(n)?.id).filter(Boolean);
  const h = raw.hotel || {};

  const trip = {
    departure: { dt: dt(raw.departure?.date, raw.departure?.time), place: clean(raw.departure?.place) },
    arrival: { dt: dt(raw.arrival?.date || raw.departure?.date, raw.arrival?.time) },
    ret: { dt: dt(raw.return?.date, raw.return?.time), place: clean(raw.return?.place), arrivalDt: '' },
    vehicles: (Array.isArray(raw.vehicles) ? raw.vehicles : []).map((v, i) => {
      const driverId = v?.driver ? findOrAdd(v.driver)?.id || '' : '';
      return {
        id: uid('v_'), name: clean(v?.name) || `Pojazd ${i + 1}`, plate: clean(v?.plate),
        driverId, passengerIds: [...new Set(ids(v?.passengers))].filter(id => id !== driverId)
      };
    }),
    hotel: {
      name: clean(h.name), address: clean(h.address), phone: clean(h.phone),
      checkIn: dt(h.checkInDate, h.checkInTime), checkOut: dt(h.checkOutDate, h.checkOutTime)
    },
    hotelRooms: (Array.isArray(raw.hotelRooms) ? raw.hotelRooms : []).map(r => ({ id: uid('h_'), number: clean(r?.number), personIds: [...new Set(ids(r?.people))] })),
    calls: (Array.isArray(raw.calls) ? raw.calls : [])
      .map(c => ({ id: uid('c_'), dt: dt(c?.date, c?.time), label: clean(c?.label) || 'Call', personIds: [...new Set(ids(c?.people))] }))
      .filter(c => c.dt)
      .sort((a, b) => a.dt.localeCompare(b.dt)),
    notes: clean(Array.isArray(raw.notes) ? raw.notes.join('\n') : raw.notes).slice(0, 4000)
  };
  // keep line breaks in notes
  if (typeof raw.notes === 'string') trip.notes = raw.notes.trim().slice(0, 4000);
  // a return time earlier than the last call (e.g. 02:00 after a 23:30 load-out) is the next day
  const latest = [trip.departure.dt, ...trip.calls.map(c => c.dt)].filter(Boolean).sort().pop();
  if (trip.ret.dt && latest && trip.ret.dt < latest && !isDate(raw.return?.date)) trip.ret.dt = addMinutesDT(trip.ret.dt, 1440);
  return { crew, trip };
}
