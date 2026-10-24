// App state: events in memory + IndexedDB persistence, settings in localStorage,
// shared time cursor (used by "Teraz" and "Ekipa"), backup import/export.

import { db } from './db.js';
import {
  uid, todayStr, isDate, isTime, isDT, parseDT, parseDate, daysBetween, normalize, dtStr, combine, addDays
} from './util.js';

export const VAT_RATES = [23, 8, 0];
export const EVENT_TYPES =['konferencja', 'gala', 'teatr', 'koncert', 'sport', 'targi', 'event firmowy', 'inne'];

export const state = { events: [] };

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } }); }

/* ---------- settings (localStorage only) ---------- */

const SKEY = 'eventcal.settings.v1';
const DEFAULTS = { me: 'Jacob', apiKey: '', night: false, seeded: false, lastEventId: '' };
let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(SKEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
export function getSettings() { return settings; }
export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

/* ---------- shared time cursor ---------- */

export const cursor = { live: true, date: '', min: 0 };
export function cursorDate() {
  if (cursor.live) return new Date();
  const d = parseDate(cursor.date) || new Date();
  d.setHours(0, cursor.min, 0, 0);
  return d;
}

/* ---------- model ---------- */

export function blankTrip() {
  return {
    departure: { dt: '', place: '' },
    arrival: { dt: '' },
    ret: { dt: '', place: '', arrivalDt: '' },
    vehicles: [],
    hotel: { name: '', address: '', phone: '', checkIn: '', checkOut: '' },
    hotelRooms: [],
    calls: [],
    notes: ''
  };
}

const str = v => (v == null ? '' : String(v));
const dt = v => (isDT(v) ? v : '');
const arr = v => (Array.isArray(v) ? v : []);

export function normalizeSession(s = {}) {
  return {
    id: s.id || uid('s_'),
    date: isDate(s.date) ? s.date : '',
    start: isTime(s.start) ? s.start : '',
    end: isTime(s.end) ? s.end : '',
    title: str(s.title),
    speaker: str(s.speaker),
    notes: str(s.notes),
    cues: str(s.cues)
  };
}
export function normalizeRoom(r = {}) {
  return {
    id: r.id || uid('r_'), name: str(r.name) || 'Sala', sessions: arr(r.sessions).map(normalizeSession),
    // people tied to this room only (venue tech, stage manager, client host…), separate from the crew
    contacts: arr(r.contacts).map(c => ({ id: c.id || uid('k_'), name: str(c.name), role: str(c.role), phone: str(c.phone) }))
  };
}
export function normalizePerson(p = {}) {
  return { id: p.id || uid('p_'), name: str(p.name), role: str(p.role), phone: str(p.phone), roomId: str(p.roomId), notes: str(p.notes) };
}
export function normalizeTrip(t = {}) {
  const b = blankTrip();
  t = t || {};
  return {
    departure: { dt: dt(t.departure?.dt), place: str(t.departure?.place) },
    arrival: { dt: dt(t.arrival?.dt) },
    ret: { dt: dt(t.ret?.dt), place: str(t.ret?.place), arrivalDt: dt(t.ret?.arrivalDt) },
    vehicles: arr(t.vehicles).map(v => ({
      id: v.id || uid('v_'), name: str(v.name) || 'Pojazd', plate: str(v.plate),
      driverId: str(v.driverId), passengerIds: arr(v.passengerIds).map(String)
    })),
    hotel: { ...b.hotel, ...(t.hotel || {}), checkIn: dt(t.hotel?.checkIn), checkOut: dt(t.hotel?.checkOut) },
    hotelRooms: arr(t.hotelRooms).map(h => ({ id: h.id || uid('h_'), number: str(h.number), personIds: arr(h.personIds).map(String) })),
    calls: arr(t.calls).map(c => ({ id: c.id || uid('c_'), dt: dt(c.dt), label: str(c.label) || 'Call', personIds: arr(c.personIds).map(String) })),
    notes: str(t.notes)
  };
}
export function normalizeEvent(ev = {}) {
  const start = isDate(ev.startDate) ? ev.startDate : todayStr();
  const end = isDate(ev.endDate) && ev.endDate >= start ? ev.endDate : start;
  return {
    id: ev.id || uid('ev_'),
    name: str(ev.name) || 'Nowe wydarzenie',
    client: str(ev.client),
    venue: str(ev.venue),
    address: str(ev.address),
    type: EVENT_TYPES.includes(ev.type) ? ev.type : 'inne',
    startDate: start,
    endDate: end,
    loadIn: dt(ev.loadIn),
    showStart: dt(ev.showStart),
    showEnd: dt(ev.showEnd),
    loadOut: dt(ev.loadOut),
    notes: str(ev.notes),
    // my fee: stored net + VAT rate (0 = zw. / bez VAT); gross is always computed from these
    fee: {
      net: Number.isFinite(ev.fee?.net) && ev.fee.net >= 0 ? ev.fee.net : null,
      vat: VAT_RATES.includes(ev.fee?.vat) ? ev.fee.vat : 23,
      paid: !!ev.fee?.paid
    },
    contacts: arr(ev.contacts).map(c => ({ id: c.id || uid('k_'), name: str(c.name), role: str(c.role), phone: str(c.phone), email: str(c.email) })),
    rooms: arr(ev.rooms).map(normalizeRoom),
    crew: arr(ev.crew).map(normalizePerson),
    trip: normalizeTrip(ev.trip),
    checklist: arr(ev.checklist).map(i => ({ id: i.id || uid('i_'), group: str(i.group) || 'Inne', text: str(i.text), done: !!i.done })),
    files: arr(ev.files).map(f => ({ id: str(f.id), name: str(f.name), kind: str(f.kind), size: Number(f.size) || 0, addedAt: Number(f.addedAt) || Date.now() })),
    demo: !!ev.demo,
    createdAt: Number(ev.createdAt) || Date.now(),
    updatedAt: Number(ev.updatedAt) || Date.now()
  };
}
export function newEvent(partial = {}) {
  return normalizeEvent({ type: 'konferencja', ...partial, id: partial.id || uid('ev_') });
}

/* ---------- persistence ---------- */

export async function loadAll() {
  const list = await db.getAll('events');
  state.events = (list || []).map(normalizeEvent);
  sortEvents();
}
function sortEvents() {
  state.events.sort((a, b) => (a.startDate + (a.loadIn || '')).localeCompare(b.startDate + (b.loadIn || '')));
}
export function getEvent(id) { return state.events.find(e => e.id === id) || null; }

export async function saveEvent(ev) {
  ev.updatedAt = Date.now();
  const i = state.events.findIndex(e => e.id === ev.id);
  if (i >= 0) state.events[i] = ev; else state.events.push(ev);
  sortEvents();
  await db.put('events', JSON.parse(JSON.stringify(ev)));
  emit();
  return ev;
}
export async function deleteEvent(id) {
  const ev = getEvent(id);
  state.events = state.events.filter(e => e.id !== id);
  await db.del('events', id);
  if (ev) for (const f of ev.files) { try { await db.del('files', f.id); } catch { /* ignore */ } }
  if (settings.lastEventId === id) setSetting('lastEventId', '');
  emit();
}

/* ---------- stored files (PDF) ---------- */

export async function saveFile(eventId, name, arrayBuffer, type = 'application/pdf') {
  const id = uid('f_');
  await db.put('files', { id, eventId, name, type, size: arrayBuffer.byteLength, data: arrayBuffer, createdAt: Date.now() });
  return id;
}
export const getFile = id => db.get('files', id);
export const deleteFile = id => db.del('files', id);

/* ---------- queries ---------- */

export function eventBounds(ev) {
  const cands = [parseDT(ev.startDate + 'T00:00'), parseDT(ev.loadIn), parseDT(ev.trip.departure.dt)].filter(Boolean);
  const ends = [parseDT(ev.endDate + 'T23:59'), parseDT(ev.loadOut), parseDT(ev.trip.ret.dt), parseDT(ev.trip.ret.arrivalDt)].filter(Boolean);
  return {
    start: new Date(Math.min(...cands.map(d => d.getTime()))),
    end: new Date(Math.max(...ends.map(d => d.getTime())))
  };
}
export function eventStatus(ev, now = new Date()) {
  const { start, end } = eventBounds(ev);
  if (now < start) return 'upcoming';
  if (now > end) return 'past';
  return 'live';
}
export function upcomingEvents(now = new Date()) {
  return state.events.filter(e => eventStatus(e, now) !== 'past');
}
export function pastEvents(now = new Date()) {
  return state.events.filter(e => eventStatus(e, now) === 'past').reverse();
}
export function activeEvent(now = new Date()) {
  const live = state.events.filter(e => eventStatus(e, now) === 'live');
  if (live.length) return live.find(e => e.id === settings.lastEventId) || live[0];
  const last = getEvent(settings.lastEventId);
  if (last) return last;
  const up = state.events.filter(e => eventStatus(e, now) === 'upcoming');
  if (up.length) return up[0];
  return state.events[state.events.length - 1] || null;
}
export function eventDays(ev) {
  const set = new Set(daysBetween(ev.startDate, ev.endDate));
  for (const r of ev.rooms) for (const s of r.sessions) if (s.date) set.add(s.date);
  return [...set].sort();
}
/** Days that actually have sessions; falls back to all event days. */
export function agendaDays(ev) {
  const set = new Set();
  for (const r of ev.rooms) {
    for (const s of r.sessions) {
      if (!s.date) continue;
      set.add(s.date);
      // 22:00–02:00 also happens on the next calendar day
      if (s.end && s.start && s.end < s.start) set.add(addDays(s.date, 1));
    }
  }
  return set.size ? [...set].sort() : eventDays(ev);
}
export function findMe(ev) {
  if (!ev) return null;
  const me = normalize(settings.me);
  if (!me) return null;
  const crew = ev.crew;
  return crew.find(p => normalize(p.name) === me)
    || crew.find(p => normalize(p.name).split(' ')[0] === me.split(' ')[0])
    || crew.find(p => normalize(p.name).includes(me))
    || null;
}
export const personById = (ev, id) => ev.crew.find(p => p.id === id) || null;
export const roomById = (ev, id) => ev.rooms.find(r => r.id === id) || null;

/** All timed milestones of an event, sorted. personIds empty = everyone. */
export function milestones(ev) {
  const out = [];
  // key: stable per-milestone id (used e.g. as the .ics UID, so re-imports update instead of duplicating)
  const add = (dtv, label, kind, personIds = [], key = kind) => { if (isDT(dtv)) out.push({ dt: dtv, label, kind, personIds, eventId: ev.id, key }); };
  const t = ev.trip;
  add(t.departure.dt, `Wyjazd${t.departure.place ? ' – ' + t.departure.place : ''}`, 'departure');
  add(t.arrival.dt, 'Przyjazd na miejsce', 'arrival');
  add(ev.loadIn, 'Montaż', 'loadin');
  add(ev.showStart, 'Start show', 'show');
  add(ev.showEnd, 'Koniec show', 'showend');
  add(ev.loadOut, 'Demontaż', 'loadout');
  add(t.ret.dt, `Powrót${t.ret.place ? ' – ' + t.ret.place : ''}`, 'return');
  add(t.hotel.checkIn, `Hotel – zameldowanie${t.hotel.name ? ' (' + t.hotel.name + ')' : ''}`, 'hotel', [], 'hotel-in');
  add(t.hotel.checkOut, 'Hotel – wymeldowanie', 'hotel', [], 'hotel-out');
  for (const c of t.calls) add(c.dt, c.label, 'call', c.personIds, c.id);
  out.sort((a, b) => a.dt.localeCompare(b.dt));
  return out;
}

/** Next milestone relevant to "me" across all events. */
export function nextMilestone(now = new Date()) {
  const nowS = dtStr(now);
  let best = null;
  for (const ev of state.events) {
    if (eventStatus(ev, now) === 'past') continue;
    const me = findMe(ev);
    for (const m of milestones(ev)) {
      if (m.dt <= nowS || m.kind === 'hotel') continue;
      if (m.personIds.length && me && !m.personIds.includes(me.id)) continue;
      if (!best || m.dt < best.dt) best = { ...m, event: ev };
    }
  }
  return best;
}

export function touchEvent(id) { if (id && settings.lastEventId !== id) setSetting('lastEventId', id); }

/* ---------- backup ---------- */

function abToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function b64ToAb(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function exportBackup(includeFiles = true) {
  const files = includeFiles ? (await db.getAll('files')) || [] : [];
  return {
    app: 'jacob-light-event-cal',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { me: settings.me },
    events: state.events,
    files: files.map(f => ({ id: f.id, eventId: f.eventId, name: f.name, type: f.type, size: f.size, createdAt: f.createdAt, data: abToB64(f.data) }))
  };
}

export async function importBackup(obj, replace = false) {
  if (!obj || obj.app !== 'jacob-light-event-cal' || !Array.isArray(obj.events)) {
    throw new Error('To nie jest kopia zapasowa Event Cal.');
  }
  if (replace) {
    await db.clear('events');
    await db.clear('files');
    state.events = [];
  }
  for (const raw of obj.events) {
    const ev = normalizeEvent(raw);
    const i = state.events.findIndex(e => e.id === ev.id);
    if (i >= 0) state.events[i] = ev; else state.events.push(ev);
    await db.put('events', ev);
  }
  for (const f of Array.isArray(obj.files) ? obj.files : []) {
    try { await db.put('files', { ...f, data: b64ToAb(f.data) }); } catch (e) { console.warn('Pominięto plik', f.name, e); }
  }
  if (obj.settings?.me) setSetting('me', obj.settings.me);
  sortEvents();
  emit();
  return obj.events.length;
}

export async function wipeAll() {
  await db.clear('events');
  await db.clear('files');
  state.events = [];
  emit();
}

export { combine };
