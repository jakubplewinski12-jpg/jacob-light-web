// Start screen: countdown to next call, live events, quick actions, upcoming list.

import { esc, fmtDT, parseDT, countdown, dateStr, minutesOfDay } from '../util.js';
import { icon } from '../icons.js';
import { state, nextMilestone, eventStatus, upcomingEvents, findMe, getSettings } from '../store.js';
import { setHeader, NIGHT_ACTION, emptyState } from '../ui.js';
import { eventCard } from './common.js';
import { roomStatus } from '../timeline.js';
import { whereIs } from '../whereabouts.js';

function countdownCard(next) {
  return `
  <a class="card cd-card" href="#/me/${esc(next.event.id)}">
    <div class="cd-head"><span class="eyebrow">Następny call</span><span class="small muted">${esc(fmtDT(next.dt))}</span></div>
    <div class="cd-time" data-cd="${esc(next.dt)}">--:--:--</div>
    <div class="cd-what">${esc(next.label)}</div>
    <div class="small muted">${esc(next.event.name)}</div>
  </a>`;
}

function liveCard(ev, now) {
  const date = dateStr(now), min = minutesOfDay(now);
  let running = 0;
  for (const r of ev.rooms) if (roomStatus(r, date, min).current) running++;
  const me = findMe(ev);
  const w = me ? whereIs(ev, me, now) : null;
  return `
  <section class="card live-card">
    <div class="ev-top"><span class="badge live">Trwa</span><span class="small muted">${esc(ev.venue || '')}</span></div>
    <h2 class="live-title">${esc(ev.name)}</h2>
    <p class="small muted">${ev.rooms.length ? `Sesja trwa w ${running} z ${ev.rooms.length} ${ev.rooms.length === 1 ? "sali" : "sal"}` : 'Brak sal w agendzie'}</p>
    ${w ? `<div class="me-line">${icon(w.icon)}<div><strong>${esc(w.title)}</strong><span class="small muted">${esc(w.detail || '')}</span></div></div>` : ''}
    <div class="btn-grid">
      <a class="btn primary" href="#/now/${esc(ev.id)}">${icon('clock')}Teraz</a>
      <a class="btn" href="#/event/${esc(ev.id)}?tab=rooms">${icon('door')}Sale</a>
      <a class="btn" href="#/crew/${esc(ev.id)}">${icon('users')}Ekipa</a>
      <a class="btn" href="#/me/${esc(ev.id)}">${icon('user')}Mój plan</a>
    </div>
  </section>`;
}

export function render({ el }) {
  setHeader({
    title: 'Event Cal', sub: 'Jacob Light', brand: true,
    actions: [{ id: 'search', icon: 'search', label: 'Szukaj' }, NIGHT_ACTION()],
    onAction: id => { if (id === 'search') location.hash = '#/search'; }
  });

  let currentNext = null;
  const draw = () => {
    const now = new Date();
    currentNext = nextMilestone(now);
    const live = state.events.filter(e => eventStatus(e, now) === 'live');
    const up = upcomingEvents(now).filter(e => eventStatus(e, now) === 'upcoming').slice(0, 5);
    const me = getSettings().me;
    el.innerHTML = `
      <p class="greet">Cześć${me ? ', ' + esc(me) : ''}.</p>
      ${currentNext ? countdownCard(currentNext) : ''}
      ${live.map(ev => liveCard(ev, now)).join('')}
      <section class="quick">
        <a class="quick-btn" href="#/new">${icon('plus')}<span>Nowe wydarzenie</span></a>
        <a class="quick-btn" href="#/import/agenda?new=1">${icon('file')}<span>Import agendy</span></a>
        <a class="quick-btn" href="#/import/trip?new=1">${icon('route')}<span>Karta wyjazdowa</span></a>
      </section>
      <div class="section-head"><h2 class="section-title">Nadchodzące</h2><a class="link" href="#/events">Wszystkie</a></div>
      ${up.length ? up.map(eventCard).join('') : emptyState('calendar', 'Nic nie zaplanowane', 'Dodaj wydarzenie ręcznie albo zaimportuj agendę z PDF.')}
    `;
    tick();
  };
  const tick = () => {
    const node = el.querySelector('[data-cd]');
    if (!node) return;
    const ms = parseDT(node.dataset.cd) - new Date();
    if (ms <= 0) { draw(); return; }
    const c = countdown(ms);
    node.textContent = c.days ? `${c.days} d ${c.text}` : c.text;
  };
  draw();
  const timer = setInterval(tick, 1000);
  const slow = setInterval(draw, 60000);
  return () => { clearInterval(timer); clearInterval(slow); };
}
