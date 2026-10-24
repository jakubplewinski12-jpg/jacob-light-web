// Events: upcoming / past lists, month calendar, search.

import { esc, pad, dateStr, todayStr, MONTHS_NOM, WD_HEAD, fmtDate, normalize, debounce, money, grossOf, round2, pl } from '../util.js';
import { icon } from '../icons.js';
import { state, upcomingEvents, pastEvents, roomById, eventBounds, milestones } from '../store.js';
import { setHeader, emptyState } from '../ui.js';
import { eventCard } from './common.js';

export function render({ el, query }) {
  const tab = query.tab || 'up';
  setHeader({
    title: 'Wydarzenia',
    actions: [{ id: 'search', icon: 'search', label: 'Szukaj' }, { id: 'add', icon: 'plus', label: 'Nowe wydarzenie' }],
    onAction: id => { location.hash = id === 'search' ? '#/search' : '#/new'; }
  });

  const seg = `
    <nav class="seg" aria-label="Widok listy">
      <a class="seg-btn ${tab === 'up' ? 'on' : ''}" ${tab === 'up' ? 'aria-current="page"' : ''} href="#/events?tab=up">Nadchodzące</a>
      <a class="seg-btn ${tab === 'past' ? 'on' : ''}" ${tab === 'past' ? 'aria-current="page"' : ''} href="#/events?tab=past">Minione</a>
      <a class="seg-btn ${tab === 'cal' ? 'on' : ''}" ${tab === 'cal' ? 'aria-current="page"' : ''} href="#/events?tab=cal">Miesiąc</a>
    </nav>`;

  if (tab === 'cal') {
    renderCalendar(el, seg, query);
    return;
  }
  const list = tab === 'past' ? pastEvents() : upcomingEvents();
  el.innerHTML = seg + (list.length
    ? list.map(eventCard).join('')
    : emptyState('calendar', tab === 'past' ? 'Brak minionych wydarzeń' : 'Brak nadchodzących wydarzeń', '',
      `<a class="btn primary" href="#/new">${icon('plus')}Nowe wydarzenie</a>`));
}

// from departure to return, not only the show days
function eventsOn(date) {
  return state.events.filter(e => {
    const { start, end } = eventBounds(e);
    return dateStr(start) <= date && dateStr(end) >= date;
  });
}

const DAY_LABELS = { departure: 'Wyjazd', loadin: 'Montaż', show: 'Start show', showend: 'Koniec show', loadout: 'Demontaż', return: 'Powrót' };

// "Wyjazd 06:00 · Montaż 14:00" for one event on one day
function dayPlan(ev, date) {
  return milestones(ev).filter(m => DAY_LABELS[m.kind] && m.dt.startsWith(date))
    .map(m => `${DAY_LABELS[m.kind]} ${m.dt.slice(11, 16)}`).join(' · ');
}

function renderCalendar(el, seg, query) {
  const today = todayStr();
  const ym = /^\d{4}-\d{2}$/.test(query.m || '') ? query.m : today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(y, m, 0).getDate();
  const prev = dateStr(new Date(y, m - 2, 1)).slice(0, 7);
  const next = dateStr(new Date(y, m, 1)).slice(0, 7);
  const sel = query.d && query.d.startsWith(ym) ? query.d : (today.startsWith(ym) ? today : `${ym}-01`);

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += '<span class="cal-cell blank"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${ym}-${pad(d)}`;
    const evs = eventsOn(ds);
    cells += `<a class="cal-cell ${ds === today ? 'today' : ''} ${ds === sel ? 'sel' : ''} ${evs.length ? 'has' : ''}" href="#/events?tab=cal&m=${ym}&d=${ds}" aria-label="${esc(fmtDate(ds))}${evs.length ? ', ' + evs.length + ' wydarzeń' : ''}">
      <span>${d}</span>${evs.length ? `<i class="dots">${evs.slice(0, 3).map(() => '<b></b>').join('')}</i>` : ''}</a>`;
  }
  const dayEvents = eventsOn(sel);
  // fees of events that start in this month (a multi-day job is counted once)
  const paidEvs = state.events.filter(e => e.startDate.startsWith(ym) && e.fee.net != null);
  const sum = key => round2(paidEvs.reduce((s, e) => s + key(e), 0));
  const totals = paidEvs.length ? `
    <section class="card fee month-fee">
      <div class="fee-row"><span class="eyebrow">Netto · ${pl(paidEvs.length, 'wydarzenie', 'wydarzenia', 'wydarzeń')}</span><strong>${esc(money(sum(e => e.fee.net)))}</strong></div>
      <div class="fee-row"><span class="eyebrow">Brutto</span><strong class="accent">${esc(money(sum(e => grossOf(e.fee.net, e.fee.vat))))}</strong></div>
      <div class="fee-row"><span class="eyebrow">Do zapłaty (brutto)</span><strong>${esc(money(sum(e => (e.fee.paid ? 0 : grossOf(e.fee.net, e.fee.vat)))))}</strong></div>
    </section>` : '';
  el.innerHTML = `${seg}
    <section class="card cal">
      <div class="cal-head">
        <a class="icon-btn" href="#/events?tab=cal&m=${prev}" aria-label="Poprzedni miesiąc">${icon('chevronLeft')}</a>
        <h2>${MONTHS_NOM[m - 1]} ${y}</h2>
        <a class="icon-btn" href="#/events?tab=cal&m=${next}" aria-label="Następny miesiąc">${icon('chevronRight')}</a>
      </div>
      <div class="cal-grid">${WD_HEAD.map(w => `<span class="cal-wd">${w}</span>`).join('')}${cells}</div>
    </section>
    ${totals}
    <h2 class="section-title">${esc(fmtDate(sel, { weekday: true }))}</h2>
    ${dayEvents.length ? dayEvents.map(e => {
      const plan = dayPlan(e, sel);
      return (plan ? `<p class="day-plan">${icon('clock')}${esc(plan)}</p>` : '') + eventCard(e);
    }).join('') : `<p class="muted pad">Brak wydarzeń tego dnia.</p>`}
    <a class="btn block" href="#/new?date=${sel}">${icon('plus')}Dodaj wydarzenie na ten dzień</a>`;
}

/* ---------- search ---------- */

export function renderSearch({ el }) {
  setHeader({ title: 'Szukaj', back: '#/events' });
  el.innerHTML = `
    <div class="search-box">${icon('search')}<input class="input bare" type="search" id="q" placeholder="Wydarzenie, sesja, prelegent, osoba…" autocomplete="off" enterkeyhint="search"></div>
    <div id="results"><p class="muted pad">Szukaj we wszystkich wydarzeniach, salach, sesjach i ekipie.</p></div>`;
  const q = el.querySelector('#q');
  const out = el.querySelector('#results');
  const run = () => {
    const term = normalize(q.value);
    if (term.length < 2) { out.innerHTML = `<p class="muted pad">Wpisz co najmniej 2 znaki.</p>`; return; }
    const has = (...vals) => vals.some(v => normalize(v).includes(term));
    const evs = [], sess = [], people = [];
    for (const ev of state.events) {
      if (has(ev.name, ev.client, ev.venue, ev.address, ev.notes)) evs.push(ev);
      for (const r of ev.rooms) {
        for (const s of r.sessions) {
          if (has(s.title, s.speaker, s.notes, s.cues) && sess.length < 60) sess.push({ ev, r, s });
        }
      }
      for (const p of ev.crew) if (has(p.name, p.role, p.phone)) people.push({ ev, p });
    }
    const blocks = [];
    if (evs.length) blocks.push(`<h2 class="section-title">Wydarzenia</h2>${evs.map(eventCard).join('')}`);
    if (sess.length) blocks.push(`<h2 class="section-title">Sesje</h2><div class="card list">${sess.map(({ ev, r, s }) => `
      <a class="list-row" href="#/room/${esc(ev.id)}/${esc(r.id)}?d=${esc(s.date)}">
        <span class="time-col">${esc(s.start)}<small>${esc(fmtDate(s.date, { short: true }))}</small></span>
        <span class="grow"><strong>${esc(s.title)}</strong><small class="muted">${esc([r.name, s.speaker].filter(Boolean).join(' · '))}</small></span>
      </a>`).join('')}</div>`);
    if (people.length) blocks.push(`<h2 class="section-title">Ekipa</h2><div class="card list">${people.map(({ ev, p }) => `
      <a class="list-row" href="#/event/${esc(ev.id)}?tab=crew">
        <span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <span class="grow"><strong>${esc(p.name)}</strong><small class="muted">${esc([p.role, roomById(ev, p.roomId)?.name, ev.name].filter(Boolean).join(' · '))}</small></span>
      </a>`).join('')}</div>`);
    out.innerHTML = blocks.join('') || `<p class="muted pad">Nic nie znaleziono.</p>`;
  };
  q.addEventListener('input', debounce(run, 180));
  setTimeout(() => q.focus(), 50);
}
