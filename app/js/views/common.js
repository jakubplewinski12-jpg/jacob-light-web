// Shared view fragments: event cards, status badges, event switcher.

import { esc, fmtRange, fmtDate, parseDate, todayStr, pl } from '../util.js';
import { icon } from '../icons.js';
import { state, getEvent, activeEvent, touchEvent, eventStatus } from '../store.js';
import { countSessions } from '../timeline.js';

export function resolveEvent(id) {
  const ev = (id && getEvent(id)) || activeEvent();
  if (ev) touchEvent(ev.id);
  return ev;
}

export function statusBadge(ev, now = new Date()) {
  const st = eventStatus(ev, now);
  if (st === 'live') return '<span class="badge live">Trwa</span>';
  if (st === 'past') return '<span class="badge">Zakończone</span>';
  const days = Math.round((parseDate(ev.startDate) - parseDate(todayStr())) / 86400000);
  const label = days <= 0 ? 'Dziś' : days === 1 ? 'Jutro' : `Za ${days} dni`;
  return `<span class="badge soon">${label}</span>`;
}

export function eventCard(ev) {
  const sessions = countSessions(ev);
  const meta = [
    ev.venue,
    ev.rooms.length ? `${ev.rooms.length} ${pluralSale(ev.rooms.length)}` : '',
    sessions ? pl(sessions, "sesja", "sesje", "sesji") : '',
    ev.crew.length ? `${ev.crew.length} os.` : ''
  ].filter(Boolean).join(' · ');
  return `
  <a class="card ev-card" href="#/event/${esc(ev.id)}">
    <div class="ev-date">
      <span class="ev-day">${esc(String(parseDate(ev.startDate).getDate()))}</span>
      <span class="ev-mon">${esc(fmtDate(ev.startDate, { short: true }).split(' ')[1] || '')}</span>
    </div>
    <div class="ev-body">
      <div class="ev-top"><span class="tag">${esc(ev.type)}</span>${statusBadge(ev)}</div>
      <h3>${esc(ev.name)}</h3>
      <p class="muted small">${esc(fmtRange(ev.startDate, ev.endDate))}</p>
      ${meta ? `<p class="muted small">${esc(meta)}</p>` : ''}
    </div>
    ${icon('chevronRight', 'chev')}
  </a>`;
}

export function eventSwitcher(ev, base) {
  if (state.events.length < 2) return '';
  return `<div class="ev-switch">${icon('calendar')}<select class="input bare" data-ev-switch="${esc(base)}" aria-label="Wybierz wydarzenie">
    ${state.events.map(e => `<option value="${esc(e.id)}" ${e.id === ev.id ? 'selected' : ''}>${esc(e.name)} · ${esc(fmtDate(e.startDate, { short: true }))}</option>`).join('')}
  </select>${icon('chevronDown')}</div>`;
}

/** Call from a view's onchange handler; returns true when handled. */
export function handleEventSwitch(e) {
  const s = e.target.closest('[data-ev-switch]');
  if (!s) return false;
  location.hash = s.dataset.evSwitch + encodeURIComponent(s.value);
  return true;
}

export function noEvent(el, text = 'Dodaj wydarzenie albo zaimportuj agendę.') {
  el.innerHTML = `<div class="empty">${icon('calendar', 'empty-ic')}<h3>Brak wydarzeń</h3><p>${esc(text)}</p>
    <a class="btn primary" href="#/new">${icon('plus')}Nowe wydarzenie</a></div>`;
}

export function pluralSale(n) {
  return n === 1 ? 'sala' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'sale' : 'sal';
}
