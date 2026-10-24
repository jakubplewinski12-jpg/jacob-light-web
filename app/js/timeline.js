// Session timing helpers: what is on in a room at a given minute, day ranges.

import { toMin, addDays } from './util.js';

export function sessStart(s) { return toMin(s.start) ?? 0; }
export function sessEnd(s) {
  const a = sessStart(s);
  let b = s.end ? toMin(s.end) : a + 60;
  if (b <= a) b += 1440; // crosses midnight
  return b;
}

export function roomSessionsOn(room, date) {
  return room.sessions
    .filter(s => s.date === date && s.start)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Sessions of the previous day that are still running after midnight (e.g. 22:00–02:00). */
export function carriedOver(room, date) {
  const prev = addDays(date, -1);
  return room.sessions.filter(s => s.date === prev && s.start && sessEnd(s) > 1440);
}

export function roomStatus(room, date, min) {
  const list = roomSessionsOn(room, date);
  let current = null, next = null, offset = 0;
  // a party that started yesterday at 22:00 is still "now" at 00:30
  for (const s of carriedOver(room, date)) {
    if (min + 1440 < sessEnd(s)) { current = s; offset = 1440; break; }
  }
  for (const s of list) {
    const a = sessStart(s), b = sessEnd(s);
    if (a <= min && min < b) { if (!current) current = s; }
    else if (a > min && !next) next = s;
  }
  let progress = 0;
  if (current) {
    const m = current.date === date ? min : min + offset;
    progress = (m - sessStart(current)) / Math.max(1, sessEnd(current) - sessStart(current));
  }
  return { current, next, progress, list };
}

/** Minutes left in session s at minute `min` of `date` (handles sessions carried over midnight). */
export function minutesLeft(s, date, min) {
  return sessEnd(s) - (s.date === date ? min : min + 1440);
}

/** Minute range covering all sessions of a day (rounded to full hours). */
export function dayRange(ev, date) {
  let from = Infinity, to = -Infinity;
  for (const r of ev.rooms) {
    for (const s of r.sessions) {
      if (s.date !== date || !s.start) continue;
      from = Math.min(from, sessStart(s));
      to = Math.max(to, sessEnd(s));
    }
  }
  if (!Number.isFinite(from)) return { from: 8 * 60, to: 20 * 60, empty: true };
  return { from: Math.floor(from / 60) * 60, to: Math.min(24 * 60 + 120, Math.ceil(to / 60) * 60), empty: false };
}

export function sortRoomSessions(room) {
  room.sessions.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function countSessions(ev) {
  return ev.rooms.reduce((n, r) => n + r.sessions.length, 0);
}
