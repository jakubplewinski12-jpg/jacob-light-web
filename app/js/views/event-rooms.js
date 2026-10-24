// Rooms tab inside an event + single room agenda screen (#/room/:eventId/:roomId).

import { esc, uid, dateStr, minutesOfDay, fmtDate, toMin, fromMin, initials, isDate, isTime, pl, telHref } from '../util.js';
import { icon } from '../icons.js';
import { getEvent, saveEvent, agendaDays, eventDays, normalizeSession, touchEvent } from '../store.js';
import { setHeader, openSheet, confirmDialog, toast, field, input, textarea, select, row2, emptyState } from '../ui.js';
import { roomStatus, roomSessionsOn, sortRoomSessions, sessEnd } from '../timeline.js';

/* ---------- tab inside event ---------- */

export function html(ev) {
  const now = new Date();
  const date = dateStr(now), min = minutesOfDay(now);
  const rows = ev.rooms.map(r => {
    const st = roomStatus(r, date, min);
    const crew = [...ev.crew.filter(p => p.roomId === r.id), ...(r.contacts || [])];
    const line = st.current
      ? `<span class="dot live"></span>Teraz: ${esc(st.current.title)}`
      : st.next ? `Dalej ${esc(st.next.start)}: ${esc(st.next.title)}` : pl(r.sessions.length, "sesja", "sesje", "sesji");
    return `
    <a class="card room-row" href="#/room/${esc(ev.id)}/${esc(r.id)}">
      <div class="grow">
        <h3>${esc(r.name)}</h3>
        <p class="small muted">${line}</p>
        ${crew.length ? `<div class="mini-crew">${crew.map(p => `<span class="avatar xs" title="${esc(p.name)}">${esc(initials(p.name))}</span>`).join('')}<span class="small muted">${esc(crew.map(p => p.name.split(' ')[0]).join(', '))}</span></div>` : ''}
      </div>
      <span class="count">${r.sessions.length}</span>
      ${icon('chevronRight', 'chev')}
    </a>`;
  }).join('');
  return `
    <div class="btn-grid">
      <a class="btn primary" href="#/now/${esc(ev.id)}">${icon('clock')}Teraz / siatka</a>
      <button class="btn" data-act="room-add">${icon('plus')}Dodaj sale</button>
    </div>
    ${ev.rooms.length ? rows : emptyState('door', 'Brak sal', 'Dodaj sale ręcznie albo zaimportuj agendę – sale rozpoznam z nagłówków.',
      `<a class="btn primary" href="#/import/agenda?event=${esc(ev.id)}">${icon('file')}Importuj agendę</a>`)}
    ${ev.rooms.length ? `<a class="btn block ghost" href="#/import/agenda?event=${esc(ev.id)}">${icon('file')}Importuj agendę (PDF / tekst)</a>` : ''}`;
}

export async function handle(act, t, ctx) {
  if (act !== 'room-add') return false;
  openSheet({
    title: 'Dodaj sale',
    body: field('Nazwy sal – każda w nowej linii', textarea('names', '', { rows: 6, placeholder: 'Sala A\nSala B\nFoyer' }),
      'Możesz dodać kilka sal naraz.'),
    actions: [{
      label: 'Dodaj', kind: 'primary', onClick: async api => {
        const names = api.data().names.split('\n').map(s => s.trim()).filter(Boolean);
        if (!names.length) { toast('Wpisz nazwę sali', 'err'); return false; }
        for (const n of names) ctx.ev.rooms.push({ id: uid('r_'), name: n, sessions: [] });
        await ctx.save();
        toast(names.length === 1 ? 'Dodano salę' : `Dodano ${pl(names.length, "salę", "sale", "sal")}`);
      }
    }]
  });
  return true;
}

/* ---------- session editor (shared with "Teraz") ---------- */

export function sessionSheet(ev, room, sess, onSaved, defaults = {}) {
  const isNew = !sess;
  const days = eventDays(ev);
  const s = sess ? { ...sess } : normalizeSession({ date: defaults.date || days[0], start: defaults.start || '09:00', end: defaults.end || '' });
  if (isNew && !s.end) s.end = fromMin((toMin(s.start) + 60) % 1440);
  const dayOpts = [...new Set([...days, s.date].filter(Boolean))].sort().map(d => [d, fmtDate(d, { weekday: true, short: true })]);
  const actions = [];
  if (!isNew) {
    actions.push({
      label: 'Usuń', kind: 'danger', onClick: async () => {
        room.sessions = room.sessions.filter(x => x.id !== s.id);
        await saveEvent(ev);
        onSaved();
      }
    });
  }
  actions.push({
    label: 'Zapisz', kind: 'primary', onClick: async api => {
      const d = api.data();
      if (!isTime(d.start)) { toast('Podaj godzinę startu', 'err'); return false; }
      const upd = normalizeSession({ ...s, ...d });
      // end earlier than start = ends after midnight (22:00–02:00 party); only fill a missing/equal end
      if (!upd.end || upd.end === upd.start) upd.end = fromMin((toMin(upd.start) + 30) % 1440);
      if (toMin(upd.end) < toMin(upd.start)) toast(`Sesja kończy się po północy (${upd.end} następnego dnia)`);
      if (!upd.title) upd.title = '(bez tytułu)';
      if (isNew) room.sessions.push(upd);
      else room.sessions[room.sessions.findIndex(x => x.id === s.id)] = upd;
      sortRoomSessions(room);
      await saveEvent(ev);
      onSaved();
    }
  });
  openSheet({
    title: isNew ? `Nowa sesja – ${room.name}` : room.name,
    body: `
      ${field('Dzień', select('date', dayOpts, s.date))}
      ${row2(field('Start', input('start', s.start, { type: 'time' })), field('Koniec', input('end', s.end, { type: 'time' })))}
      ${field('Tytuł', input('title', s.title === '(bez tytułu)' ? '' : s.title, { placeholder: 'Tytuł sesji' }))}
      ${field('Prelegent / prowadzący', input('speaker', s.speaker))}
      ${field('Cue / uwagi oświetleniowe', textarea('cues', s.cues, { rows: 3, placeholder: 'np. GO 12 – preset PANEL, kontry niebieskie' }))}
      ${field('Notatki', textarea('notes', s.notes, { rows: 2 }))}`,
    actions
  });
}

/* ---------- people of a room ---------- */

const callBtn = p => p.phone
  ? `<a class="icon-btn accent" href="${esc(telHref(p.phone))}" aria-label="Zadzwoń do ${esc(p.name)}">${icon('phone')}</a>` : '';

// crew assigned in "Ekipa" (read-only here) + people added to this room only
export function roomPeopleHtml(ev, room) {
  const crew = ev.crew.filter(p => p.roomId === room.id);
  const extra = room.contacts || [];
  const rows = [
    ...crew.map(p => `
      <div class="list-row">
        <a class="plain grow person" href="#/event/${esc(ev.id)}?tab=crew">
          <span class="avatar">${esc(initials(p.name))}</span>
          <span class="grow"><strong>${esc(p.name)}</strong><small class="muted">${esc([p.role || 'ekipa', p.phone].filter(Boolean).join(' · '))}</small></span>
        </a>${callBtn(p)}
      </div>`),
    ...extra.map(c => `
      <div class="list-row">
        <button class="plain grow person" data-act="rc-edit" data-id="${esc(c.id)}">
          <span class="avatar">${esc(initials(c.name))}</span>
          <span class="grow"><strong>${esc(c.name)}</strong><small class="muted">${esc([c.role, c.phone].filter(Boolean).join(' · ') || 'bez funkcji')}</small></span>
        </button>${callBtn(c)}
      </div>`)
  ];
  return `
    <div class="section-head"><h2 class="section-title">Osoby na sali</h2><button class="link" data-act="rc-add">${icon('plus')}Dodaj</button></div>
    ${rows.length ? `<div class="card list">${rows.join('')}</div>`
      : '<p class="muted small pad">Dodaj osoby odpowiedzialne za tę salę, np. technika sali, inspicjenta albo opiekuna klienta.</p>'}`;
}

export function roomContactSheet(ev, room, c, onSaved) {
  const isNew = !c;
  c = c || { id: uid('k_'), name: '', role: '', phone: '' };
  const actions = [];
  if (!isNew) {
    actions.push({
      label: 'Usuń', kind: 'danger', onClick: async () => {
        room.contacts = (room.contacts || []).filter(x => x.id !== c.id);
        await saveEvent(ev);
        onSaved();
      }
    });
  }
  actions.push({
    label: 'Zapisz', kind: 'primary', onClick: async api => {
      const d = api.data();
      if (!d.name) { toast('Podaj imię i nazwisko', 'err'); return false; }
      Object.assign(c, { name: d.name, role: d.role, phone: d.phone });
      if (isNew) (room.contacts ||= []).push(c);
      await saveEvent(ev);
      onSaved();
    }
  });
  openSheet({
    title: isNew ? `Nowa osoba – ${room.name}` : room.name,
    body: field('Imię i nazwisko', input('name', c.name))
      + field('Funkcja', input('role', c.role, { placeholder: 'np. Technik sali, inspicjent, opiekun klienta' }))
      + field('Telefon', input('phone', c.phone, { type: 'tel', placeholder: '600 100 200' })),
    actions
  });
}

/* ---------- room screen ---------- */

export function renderRoom({ el, params, query }) {
  const ev = getEvent(params.id);
  const room = ev?.rooms.find(r => r.id === params.roomId);
  if (!ev || !room) {
    setHeader({ title: 'Sala', back: '#/events' });
    el.innerHTML = emptyState('alert', 'Nie znaleziono sali');
    return;
  }
  touchEvent(ev.id);
  const days = agendaDays(ev);
  const today = dateStr(new Date());
  let day = isDate(query.d) ? query.d : (days.includes(today) ? today : days[0]);

  setHeader({
    title: room.name, sub: ev.name, back: `#/event/${ev.id}?tab=rooms`,
    actions: [{ id: 'edit', icon: 'edit', label: 'Edytuj salę' }],
    onAction: id => { if (id === 'edit') roomSheet(); }
  });

  const draw = () => {
    const now = new Date();
    const isToday = day === dateStr(now);
    const min = minutesOfDay(now);
    const list = roomSessionsOn(room, day);
    const people = [...ev.crew.filter(p => p.roomId === room.id), ...(room.contacts || [])];
    el.innerHTML = `
      ${days.length > 1 ? `<div class="chips scroll-x">${days.map(d =>
        `<button class="chip ${d === day ? 'on' : ''} ${d === today ? 'today' : ''}" data-act="day" data-date="${d}">${esc(fmtDate(d, { weekday: true, short: true }))}</button>`).join('')}</div>` : ''}
      ${people.length ? `<button class="crew-strip plain" data-act="to-people">${icon('users')}<span class="grow">${people.map(p => esc(p.name.split(' ')[0])).join(', ')}</span>${icon('phone')}</button>` : ''}
      ${list.length ? `<div class="agenda">${list.map(s => {
        const cur = isToday && toMin(s.start) <= min && min < sessEnd(s);
        const past = isToday && sessEnd(s) <= min;
        return `
        <button class="card sess ${cur ? 'current' : ''} ${past ? 'past' : ''}" data-act="sess" data-id="${esc(s.id)}">
          <span class="sess-time"><strong>${esc(s.start)}</strong><small>${esc(s.end)}</small></span>
          <span class="sess-body">
            ${cur ? '<span class="eyebrow accent">Teraz</span>' : ''}
            <strong>${esc(s.title)}</strong>
            ${s.speaker ? `<small class="muted">${esc(s.speaker)}</small>` : ''}
            ${s.cues ? `<small class="cue">${icon('bulb')}${esc(s.cues)}</small>` : ''}
            ${s.notes ? `<small class="muted note">${esc(s.notes)}</small>` : ''}
          </span>
        </button>`;
      }).join('')}</div>` : emptyState('clock', 'Brak sesji tego dnia', 'Dodaj sesję ręcznie albo zaimportuj agendę.')}
      <button class="btn block primary" data-act="add">${icon('plus')}Dodaj sesję</button>
      <div id="room-people">${roomPeopleHtml(ev, room)}</div>`;
  };

  const roomSheet = () => {
    openSheet({
      title: 'Sala',
      body: field('Nazwa sali', input('name', room.name)),
      actions: [
        {
          label: 'Usuń salę', kind: 'danger', onClick: async () => {
            const ok = await confirmDialog(`Usunąć salę „${room.name}” i ${pl(room.sessions.length, "sesję", "sesje", "sesji")}?`);
            if (!ok) return;
            ev.rooms = ev.rooms.filter(r => r.id !== room.id);
            ev.crew.forEach(p => { if (p.roomId === room.id) p.roomId = ''; });
            await saveEvent(ev);
            location.hash = `#/event/${ev.id}?tab=rooms`;
          }
        },
        {
          label: 'Zapisz', kind: 'primary', onClick: async api => {
            const n = api.data().name;
            if (!n) { toast('Podaj nazwę', 'err'); return false; }
            room.name = n;
            await saveEvent(ev);
            setHeader({ title: room.name, sub: ev.name, back: `#/event/${ev.id}?tab=rooms`, actions: [{ id: 'edit', icon: 'edit', label: 'Edytuj salę' }], onAction: id => { if (id === 'edit') roomSheet(); } });
          }
        }
      ]
    });
  };

  el.onclick = e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'day') { day = t.dataset.date; draw(); return; }
    if (t.dataset.act === 'to-people') { el.querySelector('#room-people')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (t.dataset.act === 'rc-add') { roomContactSheet(ev, room, null, draw); return; }
    if (t.dataset.act === 'rc-edit') {
      const c = (room.contacts || []).find(x => x.id === t.dataset.id);
      if (c) roomContactSheet(ev, room, c, draw);
      return;
    }
    if (t.dataset.act === 'sess') {
      const s = room.sessions.find(x => x.id === t.dataset.id);
      if (s) sessionSheet(ev, room, s, draw);
      return;
    }
    if (t.dataset.act === 'add') {
      const list = roomSessionsOn(room, day);
      const last = list[list.length - 1];
      sessionSheet(ev, room, null, draw, { date: day, start: last ? last.end : '09:00' });
    }
  };
  draw();
  const timer = setInterval(() => { if (!document.body.classList.contains('sheet-open')) draw(); }, 60000);
  return () => clearInterval(timer);
}
