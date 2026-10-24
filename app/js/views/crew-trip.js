// Crew + trip sheet display and editors. Works on any "draft" with
// { id, crew, trip, rooms } – the stored event or an import review draft.

import { esc, uid, fmtDT, telHref, initials, mapsHref } from '../util.js';
import { icon } from '../icons.js';
import { openSheet, field, input, textarea, select, peoplePicker, toast } from '../ui.js';

const nameOf = (d, id) => d.crew.find(p => p.id === id)?.name || '';
const namesOf = (d, ids) => ids.map(id => nameOf(d, id)).filter(Boolean);

function roomLabel(d, p) {
  if (p.roomId) return d.rooms.find(r => r.id === p.roomId)?.name || '';
  if (p._roomName) return `${p._roomName} (nowa sala)`;
  return '';
}

function section(title, addAct, body, addLabel = 'Dodaj') {
  return `<div class="section-head"><h2 class="section-title">${title}</h2>${addAct ? `<button class="link" data-act="${addAct}">${icon('plus')}${addLabel}</button>` : ''}</div>${body}`;
}

export function html(d, { mode = 'event' } = {}) {
  const t = d.trip;
  const linkCall = mode === 'event';

  const crew = d.crew.length ? `<div class="card list">${d.crew.map(p => `
    <div class="list-row">
      <button class="plain grow person" data-act="p-edit" data-id="${esc(p.id)}">
        <span class="avatar">${esc(initials(p.name))}</span>
        <span class="grow"><strong>${esc(p.name)}</strong><small class="muted">${esc([p.role, roomLabel(d, p)].filter(Boolean).join(' · ') || 'bez funkcji')}</small></span>
      </button>
      ${linkCall && p.phone ? `<a class="icon-btn accent" href="${esc(telHref(p.phone))}" aria-label="Zadzwoń do ${esc(p.name)}">${icon('phone')}</a>` : (p.phone ? `<small class="muted">${esc(p.phone)}</small>` : '')}
    </div>`).join('')}</div>` : '<p class="muted small pad">Brak osób.</p>';

  const dep = `<button class="card plain kv" data-act="trip-dep">
      ${icon('flag')}<span class="grow"><span class="eyebrow">Wyjazd</span>
      <strong>${t.departure.dt ? esc(fmtDT(t.departure.dt)) : 'nie ustawiono'}</strong>
      ${t.departure.place ? `<small class="muted">${esc(t.departure.place)}</small>` : ''}
      ${t.arrival.dt ? `<small class="muted">Przyjazd: ${esc(fmtDT(t.arrival.dt))}</small>` : ''}</span>${icon('edit', 'chev')}
    </button>
    <button class="card plain kv" data-act="trip-ret">
      ${icon('route')}<span class="grow"><span class="eyebrow">Powrót</span>
      <strong>${t.ret.dt ? esc(fmtDT(t.ret.dt)) : 'nie ustawiono'}</strong>
      ${t.ret.place ? `<small class="muted">${esc(t.ret.place)}</small>` : ''}
      ${t.ret.arrivalDt ? `<small class="muted">Na miejscu: ${esc(fmtDT(t.ret.arrivalDt))}</small>` : ''}</span>${icon('edit', 'chev')}
    </button>`;

  const veh = t.vehicles.length ? `<div class="card list">${t.vehicles.map(v => `
    <button class="list-row plain" data-act="v-edit" data-id="${esc(v.id)}">
      ${icon('bus')}<span class="grow"><strong>${esc(v.name)}${v.plate ? ` <span class="plate">${esc(v.plate)}</span>` : ''}</strong>
      <small class="muted">${v.driverId ? 'Kierowca: ' + esc(nameOf(d, v.driverId)) : 'Bez kierowcy'}${v.passengerIds.length ? ' · ' + esc(namesOf(d, v.passengerIds).join(', ')) : ''}</small></span>
    </button>`).join('')}</div>` : '<p class="muted small pad">Brak pojazdów.</p>';

  const h = t.hotel;
  const hotel = `<button class="card plain kv" data-act="hotel">
      ${icon('bed')}<span class="grow"><span class="eyebrow">Hotel</span>
      <strong>${esc(h.name || 'nie ustawiono')}</strong>
      ${h.address ? `<small class="muted">${esc(h.address)}</small>` : ''}
      ${h.checkIn || h.checkOut ? `<small class="muted">${h.checkIn ? 'Zameld. ' + esc(fmtDT(h.checkIn)) : ''}${h.checkIn && h.checkOut ? ' · ' : ''}${h.checkOut ? 'Wymeld. ' + esc(fmtDT(h.checkOut)) : ''}</small>` : ''}
      ${h.phone ? `<small class="muted">tel. ${esc(h.phone)}</small>` : ''}</span>${icon('edit', 'chev')}
    </button>
    ${linkCall && h.address ? `<a class="link small pad" href="${esc(mapsHref([h.name, h.address].join(', ')))}" target="_blank" rel="noopener">${icon('pin')}Nawiguj do hotelu</a>` : ''}
    ${t.hotelRooms.length ? `<div class="card list">${t.hotelRooms.map(r => `
      <button class="list-row plain" data-act="hr-edit" data-id="${esc(r.id)}">
        <span class="room-no">${esc(r.number || '?')}</span><span class="grow">${esc(namesOf(d, r.personIds).join(', ') || 'pusty')}</span>
      </button>`).join('')}</div>` : ''}`;

  const calls = t.calls.length ? `<div class="card list">${t.calls.map(c => `
    <button class="list-row plain" data-act="c-edit" data-id="${esc(c.id)}">
      <span class="time-col">${esc(c.dt.split('T')[1] || '')}<small>${esc(fmtDT(c.dt).split(',')[0])}</small></span>
      <span class="grow"><strong>${esc(c.label)}</strong><small class="muted">${c.personIds.length ? esc(namesOf(d, c.personIds).join(', ')) : 'cała ekipa'}</small></span>
    </button>`).join('')}</div>` : '<p class="muted small pad">Brak calli.</p>';

  return `
    ${mode === 'event' ? `<div class="btn-grid">
      <a class="btn primary" href="#/crew/${esc(d.id)}">${icon('users')}Gdzie kto jest</a>
      <a class="btn" href="#/me/${esc(d.id)}">${icon('user')}Mój plan</a>
    </div>
    <a class="btn block ghost" href="#/import/trip?event=${esc(d.id)}">${icon('route')}Importuj kartę wyjazdową</a>` : ''}
    ${section(`Ekipa (${d.crew.length})`, 'p-add', crew)}
    ${section('Godziny calli', 'c-add', calls)}
    ${section('Wyjazd i powrót', '', dep)}
    ${section('Pojazdy', 'v-add', veh)}
    ${section('Nocleg', 'hr-add', hotel, 'Pokój')}
    ${section('Uwagi', '', `<button class="card plain notes" data-act="notes">${t.notes ? esc(t.notes) : '<span class="muted">Dodaj uwagi…</span>'}</button>`)}`;
}

/* ---------- editors ---------- */

function removePersonRefs(d, pid) {
  const t = d.trip;
  t.vehicles.forEach(v => { if (v.driverId === pid) v.driverId = ''; v.passengerIds = v.passengerIds.filter(x => x !== pid); });
  t.hotelRooms.forEach(r => { r.personIds = r.personIds.filter(x => x !== pid); });
  t.calls.forEach(c => { c.personIds = c.personIds.filter(x => x !== pid); });
}

function personSheet(d, p, save) {
  const isNew = !p;
  p = p || { id: uid('p_'), name: '', role: '', phone: '', roomId: '', notes: '' };
  const opts = [['', '— brak —'], ...d.rooms.map(r => [r.id, r.name])];
  if (p._roomName) opts.push(['__new', `${p._roomName} (nowa sala)`]);
  const cur = p.roomId || (p._roomName ? '__new' : '');
  const actions = [];
  if (!isNew) actions.push({
    label: 'Usuń', kind: 'danger', onClick: async () => {
      d.crew = d.crew.filter(x => x.id !== p.id);
      removePersonRefs(d, p.id);
      await save();
    }
  });
  actions.push({
    label: 'Zapisz', kind: 'primary', onClick: async api => {
      const v = api.data();
      if (!v.name) { toast('Podaj imię', 'err'); return false; }
      p.name = v.name; p.role = v.role; p.phone = v.phone; p.notes = v.notes;
      if (v.roomId === '__new') p.roomId = '';
      else { p.roomId = v.roomId; delete p._roomName; }
      if (isNew) d.crew.push(p);
      await save();
    }
  });
  openSheet({
    title: isNew ? 'Nowa osoba' : p.name,
    body: field('Imię i nazwisko', input('name', p.name, { attrs: 'autocomplete="off"' }))
      + field('Funkcja', input('role', p.role, { placeholder: 'np. Technik oświetlenia' }))
      + field('Telefon', input('phone', p.phone, { type: 'tel' }))
      + field('Sala na evencie', select('roomId', opts, cur))
      + field('Notatki', textarea('notes', p.notes, { rows: 2 })),
    actions
  });
}

function vehicleSheet(d, v, save) {
  const isNew = !v;
  v = v || { id: uid('v_'), name: `Bus ${d.trip.vehicles.length + 1}`, plate: '', driverId: '', passengerIds: [] };
  const actions = [];
  if (!isNew) actions.push({ label: 'Usuń', kind: 'danger', onClick: async () => { d.trip.vehicles = d.trip.vehicles.filter(x => x.id !== v.id); await save(); } });
  actions.push({
    label: 'Zapisz', kind: 'primary', onClick: async api => {
      const x = api.data();
      v.name = x.name || 'Pojazd'; v.plate = x.plate; v.driverId = x.driverId;
      v.passengerIds = (x.passengers || []).filter(id => id !== v.driverId);
      // one person rides in one vehicle
      d.trip.vehicles.forEach(o => {
        if (o.id === v.id) return;
        o.passengerIds = o.passengerIds.filter(id => !v.passengerIds.includes(id) && id !== v.driverId);
        if (o.driverId && (o.driverId === v.driverId || v.passengerIds.includes(o.driverId))) o.driverId = '';
      });
      if (isNew) d.trip.vehicles.push(v);
      await save();
    }
  });
  openSheet({
    title: isNew ? 'Nowy pojazd' : v.name,
    body: field('Nazwa', input('name', v.name, { placeholder: 'np. Bus 1 – Sprinter' }))
      + field('Nr rejestracyjny', input('plate', v.plate, { attrs: 'autocapitalize="characters"' }))
      + field('Kierowca', select('driverId', [['', '— brak —'], ...d.crew.map(p => [p.id, p.name])], v.driverId))
      + peoplePicker('passengers', d.crew, v.passengerIds, 'Pasażerowie'),
    actions
  });
}

function hotelRoomSheet(d, r, save) {
  const isNew = !r;
  r = r || { id: uid('h_'), number: '', personIds: [] };
  const actions = [];
  if (!isNew) actions.push({ label: 'Usuń', kind: 'danger', onClick: async () => { d.trip.hotelRooms = d.trip.hotelRooms.filter(x => x.id !== r.id); await save(); } });
  actions.push({
    label: 'Zapisz', kind: 'primary', onClick: async api => {
      const x = api.data();
      r.number = x.number; r.personIds = x.people || [];
      d.trip.hotelRooms.forEach(o => { if (o.id !== r.id) o.personIds = o.personIds.filter(id => !r.personIds.includes(id)); });
      if (isNew) d.trip.hotelRooms.push(r);
      await save();
    }
  });
  openSheet({
    title: isNew ? 'Nowy pokój' : `Pokój ${r.number}`,
    body: field('Numer pokoju', input('number', r.number, { attrs: 'inputmode="numeric"' })) + peoplePicker('people', d.crew, r.personIds, 'Kto śpi w pokoju'),
    actions
  });
}

function callSheet(d, c, save) {
  const isNew = !c;
  const base = d.trip.calls[d.trip.calls.length - 1]?.dt || d.trip.departure.dt || '';
  c = c || { id: uid('c_'), dt: base, label: '', personIds: [] };
  const actions = [];
  if (!isNew) actions.push({ label: 'Usuń', kind: 'danger', onClick: async () => { d.trip.calls = d.trip.calls.filter(x => x.id !== c.id); await save(); } });
  actions.push({
    label: 'Zapisz', kind: 'primary', onClick: async api => {
      const x = api.data();
      if (!x.dt) { toast('Podaj datę i godzinę', 'err'); return false; }
      c.dt = x.dt; c.label = x.label || 'Call'; c.personIds = x.people || [];
      if (isNew) d.trip.calls.push(c);
      d.trip.calls.sort((a, b) => a.dt.localeCompare(b.dt));
      await save();
    }
  });
  openSheet({
    title: isNew ? 'Nowy call' : c.label,
    body: field('Kiedy', input('dt', c.dt, { type: 'datetime-local' }))
      + field('Co', input('label', c.label, { placeholder: 'np. Call ekipy, Próba, Demontaż' }))
      + peoplePicker('people', d.crew, c.personIds, 'Kogo dotyczy (puste = cała ekipa)'),
    actions
  });
}

function simpleSheet(title, body, apply, save) {
  openSheet({ title, body, actions: [{ label: 'Zapisz', kind: 'primary', onClick: async api => { apply(api.data()); await save(); } }] });
}

/** ctx: { ev: draft, save: async () => persist + redraw } */
export async function handle(act, t, ctx) {
  const d = ctx.ev;
  const tr = d.trip;
  const id = t.dataset.id;
  switch (act) {
    case 'p-add': personSheet(d, null, ctx.save); return true;
    case 'p-edit': personSheet(d, d.crew.find(p => p.id === id), ctx.save); return true;
    case 'v-add': vehicleSheet(d, null, ctx.save); return true;
    case 'v-edit': vehicleSheet(d, tr.vehicles.find(v => v.id === id), ctx.save); return true;
    case 'hr-add': hotelRoomSheet(d, null, ctx.save); return true;
    case 'hr-edit': hotelRoomSheet(d, tr.hotelRooms.find(r => r.id === id), ctx.save); return true;
    case 'c-add': callSheet(d, null, ctx.save); return true;
    case 'c-edit': callSheet(d, tr.calls.find(c => c.id === id), ctx.save); return true;
    case 'trip-dep':
      simpleSheet('Wyjazd',
        field('Zbiórka / wyjazd', input('dt', tr.departure.dt, { type: 'datetime-local' }))
        + field('Miejsce zbiórki', input('place', tr.departure.place, { placeholder: 'np. magazyn, ul. Fabryczna 12' }))
        + field('Przyjazd na miejsce (szac.)', input('arr', tr.arrival.dt, { type: 'datetime-local' })),
        x => { tr.departure.dt = x.dt; tr.departure.place = x.place; tr.arrival.dt = x.arr; }, ctx.save);
      return true;
    case 'trip-ret':
      simpleSheet('Powrót',
        field('Wyjazd w drogę powrotną', input('dt', tr.ret.dt, { type: 'datetime-local' }))
        + field('Skąd', input('place', tr.ret.place))
        + field('Przyjazd do bazy (szac.)', input('arr', tr.ret.arrivalDt, { type: 'datetime-local' })),
        x => { tr.ret.dt = x.dt; tr.ret.place = x.place; tr.ret.arrivalDt = x.arr; }, ctx.save);
      return true;
    case 'hotel':
      simpleSheet('Hotel',
        field('Nazwa', input('name', tr.hotel.name)) + field('Adres', input('address', tr.hotel.address))
        + field('Telefon', input('phone', tr.hotel.phone, { type: 'tel' }))
        + field('Zameldowanie', input('checkIn', tr.hotel.checkIn, { type: 'datetime-local' }))
        + field('Wymeldowanie', input('checkOut', tr.hotel.checkOut, { type: 'datetime-local' })),
        x => Object.assign(tr.hotel, x), ctx.save);
      return true;
    case 'notes':
      simpleSheet('Uwagi do wyjazdu', field('Uwagi', textarea('notes', tr.notes, { rows: 6 })), x => { tr.notes = x.notes; }, ctx.save);
      return true;
    default:
      return false;
  }
}
