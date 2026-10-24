// "Gdzie kto jest": derives a crew member's location at a given moment from
// trip sheet (vehicles, hotel, calls) + room assignment + agenda.

import { parseDT, dtStr, dateStr, minutesOfDay, toMin, splitDT, isDT, pl } from './util.js';
import { roomById, personById, milestones, eventBounds, agendaDays } from './store.js';
import { roomStatus, roomSessionsOn, sessStart, sessEnd, carriedOver } from './timeline.js';

const H = 3600e3;

export function vehicleOf(ev, pid) {
  return ev.trip.vehicles.find(v => v.driverId === pid || v.passengerIds.includes(pid)) || null;
}
export function hotelRoomOf(ev, pid) {
  return ev.trip.hotelRooms.find(h => h.personIds.includes(pid)) || null;
}
function names(ev, ids, exceptId) {
  return ids.filter(id => id !== exceptId).map(id => personById(ev, id)?.name).filter(Boolean);
}

/** Work window (minutes) on a given date: sessions, calls, load-in/out. */
export function workWindow(ev, date) {
  let from = Infinity, to = -Infinity;
  const take = (a, b = a) => { from = Math.min(from, a); to = Math.max(to, b); };
  for (const r of ev.rooms) {
    for (const s of roomSessionsOn(r, date)) take(sessStart(s) - 30, sessEnd(s) + 30);
    for (const s of carriedOver(r, date)) take(0, sessEnd(s) - 1440 + 30); // after-midnight part
  }
  for (const c of ev.trip.calls) { const p = splitDT(c.dt); if (p.date === date) take(toMin(p.time)); }
  for (const k of ['loadIn', 'showStart', 'showEnd', 'loadOut']) {
    const p = splitDT(ev[k]);
    if (p.date === date) take(toMin(p.time));
  }
  if (!Number.isFinite(from)) return null;
  if (to - from < 60) to = from + 8 * 60;
  return { from, to };
}

function travelEnd(ev, dep, explicitArrival) {
  const arr = parseDT(explicitArrival);
  if (arr && arr > dep) return arr;
  const later = milestones(ev)
    .filter(m => m.kind === 'call' || m.kind === 'loadin')
    .map(m => parseDT(m.dt))
    .filter(d => d && d > dep);
  const cap = new Date(dep.getTime() + 4 * H);
  return later.length ? new Date(Math.min(cap.getTime(), ...later.map(d => d.getTime()))) : cap;
}

/** Next milestone for this person after `now`. */
export function nextFor(ev, person, now) {
  const s = dtStr(now);
  return milestones(ev).find(m => m.dt > s && (!m.personIds.length || m.personIds.includes(person.id))) || null;
}

export function whereIs(ev, person, now) {
  const pid = person.id;
  const t = ev.trip;
  const date = dateStr(now);
  const min = minutesOfDay(now);
  const veh = vehicleOf(ev, pid);
  const vehRole = veh ? (veh.driverId === pid ? 'kierowca' : 'pasażer') : '';
  const next = nextFor(ev, person, now);
  const vehicleState = (title, arrival) => ({
    kind: 'vehicle', icon: 'bus',
    title: veh ? veh.name : title,
    detail: [veh ? vehRole : '', veh?.plate, arrival ? `przyjazd ~${arrival}` : ''].filter(Boolean).join(' · ') || title,
    next
  });

  // Outbound travel
  const dep = parseDT(t.departure.dt);
  if (dep) {
    const arr = travelEnd(ev, dep, t.arrival.dt);
    if (now < dep && dep - now < 12 * H) {
      return { kind: 'before', icon: 'flag', title: 'Przed wyjazdem', detail: `Zbiórka ${splitDT(t.departure.dt).time}${t.departure.place ? ' – ' + t.departure.place : ''}${veh ? ' · ' + veh.name : ''}`, next };
    }
    if (now >= dep && now < arr) {
      const a = dtStr(arr).split('T')[1];
      return vehicleState('W drodze', a);
    }
  }

  // Return travel
  const ret = parseDT(t.ret.dt);
  if (ret && now >= ret) {
    const rarr = parseDT(t.ret.arrivalDt) || new Date(ret.getTime() + 4 * H);
    if (now < rarr) return vehicleState('Powrót', dtStr(rarr).split('T')[1]);
    return { kind: 'home', icon: 'home', title: 'Po powrocie', detail: 'Wydarzenie zakończone', next: null };
  }

  // At work
  const ww = workWindow(ev, date);
  const inEventDays = (date >= ev.startDate && date <= ev.endDate) || agendaDays(ev).includes(date);
  if (ww && inEventDays && min >= ww.from && min <= ww.to) {
    const room = roomById(ev, person.roomId);
    if (room) {
      const st = roomStatus(room, date, min);
      const detail = st.current
        ? `Teraz: ${st.current.title || 'sesja'}`
        : st.next ? `Dalej ${st.next.start}: ${st.next.title || 'sesja'}` : 'Brak sesji w sali';
      return { kind: 'room', icon: 'door', title: room.name, detail, roomId: room.id, progress: st.current ? st.progress : null, next };
    }
    return { kind: 'venue', icon: 'pin', title: ev.venue || 'Na obiekcie', detail: 'na obiekcie, bez przypisanej sali', next };
  }

  // Hotel
  const hr = hotelRoomOf(ev, pid);
  const ci = parseDT(t.hotel.checkIn), co = parseDT(t.hotel.checkOut);
  const hasHotel = t.hotel.name || hr;
  const inHotelWindow = ci && co ? now >= ci && now < co : inEventDays;
  if (hasHotel && inHotelWindow) {
    const mates = hr ? names(ev, hr.personIds, pid) : [];
    return {
      kind: 'hotel', icon: 'bed',
      title: t.hotel.name || 'Hotel',
      detail: [hr ? `pokój ${hr.number}` : '', mates.length ? `z: ${mates.join(', ')}` : ''].filter(Boolean).join(' · ') || 'Nocleg',
      next
    };
  }

  const { start, end } = eventBounds(ev);
  if (now < start) return { kind: 'before', icon: 'calendar', title: 'Przed wydarzeniem', detail: next ? next.label : '', next };
  if (now > end) return { kind: 'home', icon: 'home', title: 'Po wydarzeniu', detail: '', next: null };
  return { kind: 'off', icon: 'clock', title: 'Wolne / poza grafikiem', detail: '', next };
}

/** Chronological personal plan for one crew member. */
export function personalPlan(ev, person) {
  const pid = person.id;
  const items = [];
  const add = (dt, icon, title, detail = '') => { if (isDT(dt)) items.push({ dt, icon, title, detail }); };
  const t = ev.trip;
  const veh = vehicleOf(ev, pid);
  let vehDetail = 'Brak przypisanego pojazdu';
  if (veh) {
    const driver = personById(ev, veh.driverId);
    const others = [...new Set(names(ev, veh.passengerIds, pid))];
    vehDetail = `${veh.name}${veh.plate ? ' (' + veh.plate + ')' : ''} · `
      + (veh.driverId === pid ? 'prowadzisz' : 'kierowca: ' + (driver?.name || '—'))
      + (others.length ? ` · razem z: ${others.join(', ')}` : '');
  }

  add(t.departure.dt, 'flag', `Wyjazd${t.departure.place ? ' – ' + t.departure.place : ''}`, vehDetail);
  add(t.arrival.dt, 'pin', 'Przyjazd na miejsce', ev.venue);
  const hr = hotelRoomOf(ev, pid);
  if (t.hotel.checkIn) {
    const mates = hr ? names(ev, hr.personIds, pid) : [];
    add(t.hotel.checkIn, 'bed', `Hotel: ${t.hotel.name || 'zameldowanie'}`,
      [hr ? `pokój ${hr.number}` : 'pokój nieprzypisany', mates.length ? `z: ${mates.join(', ')}` : '', t.hotel.address].filter(Boolean).join(' · '));
  }
  add(ev.loadIn, 'upload', 'Montaż', ev.venue);
  for (const c of t.calls) {
    if (c.personIds.length && !c.personIds.includes(pid)) continue;
    add(c.dt, 'clock', c.label, c.personIds.length ? 'wybrane osoby' : 'cała ekipa');
  }
  add(ev.showStart, 'play', 'Start show');
  const room = roomById(ev, person.roomId);
  if (room) {
    for (const d of agendaDays(ev)) {
      const list = roomSessionsOn(room, d);
      if (!list.length) continue;
      const last = list[list.length - 1];
      add(`${d}T${list[0].start}`, 'door', `${room.name}: ${pl(list.length, "sesja", "sesje", "sesji")}`, `${list[0].start}–${last.end || last.start} · pierwsza: ${list[0].title}`);
    }
  }
  add(ev.showEnd, 'flag', 'Koniec show');
  add(ev.loadOut, 'download', 'Demontaż');
  add(t.hotel.checkOut, 'bed', 'Hotel – wymeldowanie', t.hotel.name);
  add(t.ret.dt, 'route', `Powrót${t.ret.place ? ' – ' + t.ret.place : ''}`, vehDetail);
  items.sort((a, b) => a.dt.localeCompare(b.dt));
  return items;
}
