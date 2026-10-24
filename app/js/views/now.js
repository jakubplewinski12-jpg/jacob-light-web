// "Teraz": what is happening in every room at the selected time (cards with
// progress), plus a timeline grid (rooms = columns, time = rows).

import { esc, fmtDuration, fromMin, pad, initials } from '../util.js';
import { icon } from '../icons.js';
import { agendaDays } from '../store.js';
import { setHeader, NIGHT_ACTION, scrubState, scrubberHtml, bindScrubber, emptyState, openSheet } from '../ui.js';
import { resolveEvent, eventSwitcher, handleEventSwitch, noEvent } from './common.js';
import { roomStatus, roomSessionsOn, dayRange, sessStart, sessEnd, minutesLeft } from '../timeline.js';
import { sessionSheet } from './event-rooms.js';

let mode = 'cards';
const COL_W = 136;
const GUTTER = 48;
const PPM = 1.5; // px per minute

function cardsHtml(ev, st) {
  if (!ev.rooms.length) return emptyState('door', 'Brak sal', 'Dodaj sale albo zaimportuj agendę.', `<a class="btn primary" href="#/import/agenda?event=${esc(ev.id)}">Importuj agendę</a>`);
  let active = 0;
  const cards = ev.rooms.map(r => {
    const { current, next, progress } = roomStatus(r, st.date, st.min);
    if (current) active++;
    const crew = ev.crew.filter(p => p.roomId === r.id);
    const left = current ? minutesLeft(current, st.date, st.min) : 0;
    return `
    <article class="card room-now ${current ? 'active' : ''}">
      <header class="rn-head">
        <h3>${esc(r.name)}</h3>
        ${crew.length ? `<span class="mini-crew">${crew.map(p => `<span class="avatar xs" title="${esc(p.name)}">${esc(initials(p.name))}</span>`).join('')}</span>` : ''}
      </header>
      ${current ? `
        <button class="plain rn-now" data-act="sess" data-room="${esc(r.id)}" data-id="${esc(current.id)}">
          <span class="eyebrow accent">Teraz · ${esc(current.start)}–${esc(current.end)}</span>
          <strong class="rn-title">${esc(current.title)}</strong>
          ${current.speaker ? `<span class="small muted">${esc(current.speaker)}</span>` : ''}
          <span class="bar"><i style="width:${Math.round(progress * 100)}%"></i></span>
          <span class="small muted">jeszcze ${esc(fmtDuration(left))}</span>
          ${current.cues ? `<span class="cue">${icon('bulb')}${esc(current.cues)}</span>` : ''}
        </button>` : `
        <div class="rn-now idle"><span class="eyebrow">Teraz</span><strong class="muted">Wolne</strong></div>`}
      ${next ? `
        <button class="plain rn-next" data-act="sess" data-room="${esc(r.id)}" data-id="${esc(next.id)}">
          <span class="eyebrow">Dalej · ${esc(next.start)} <span class="muted">(za ${esc(fmtDuration(sessStart(next) - st.min))})</span></span>
          <span class="rn-next-title">${esc(next.title)}</span>
        </button>` : ''}
    </article>`;
  }).join('');
  return `<p class="small muted summary-line">Sesja trwa w ${active} z ${ev.rooms.length} ${ev.rooms.length === 1 ? 'sali' : 'sal'}</p><div class="room-cards">${cards}</div>`;
}

function gridHtml(ev, st) {
  const { from, to, empty } = dayRange(ev, st.date);
  if (empty) return emptyState('columns', 'Brak sesji tego dnia', 'Wybierz inny dzień powyżej.');
  const height = (to - from) * PPM;
  const n = ev.rooms.length;
  const hours = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  const nowIn = st.min >= from && st.min <= to;
  return `
  <div class="grid-wrap" id="grid-wrap">
    <div class="grid" style="width:${GUTTER + n * COL_W}px">
      <div class="grid-head">
        <span class="gh-corner"></span>
        ${ev.rooms.map(r => `<span class="gh" style="width:${COL_W}px">${esc(r.name)}</span>`).join('')}
      </div>
      <div class="grid-body" style="height:${height}px">
        <div class="gutter" style="height:${height}px">${hours.map(m => `<span style="top:${(m - from) * PPM}px">${pad(Math.floor(m / 60) % 24)}:00</span>`).join('')}</div>
        <div class="gcols" style="width:${n * COL_W}px;height:${height}px">
          ${hours.map(m => `<i class="hline" style="top:${(m - from) * PPM}px"></i>`).join('')}
          ${ev.rooms.map((r, i) => roomSessionsOn(r, st.date).map(s => {
            const a = sessStart(s), b = sessEnd(s);
            const cur = a <= st.min && st.min < b;
            const past = b <= st.min;
            const h = Math.max(18, (b - a) * PPM - 3);
            return `<button class="gblock ${cur ? 'on' : ''} ${past ? 'past' : ''} ${h < 34 ? 'tiny' : ''}" data-act="sess" data-room="${esc(r.id)}" data-id="${esc(s.id)}"
              style="left:${i * COL_W + 3}px;top:${(a - from) * PPM + 1}px;width:${COL_W - 6}px;height:${h}px">
              <b>${esc(s.start)}</b> ${esc(s.title)}</button>`;
          }).join('')).join('')}
          ${nowIn ? `<div class="now-line" style="top:${(st.min - from) * PPM}px"><span>${fromMin(st.min)}</span></div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

function sessionInfo(ev, room, s, redraw) {
  openSheet({
    title: s.title,
    body: `
      <p class="eyebrow">${esc(room.name)} · ${esc(s.start)}–${esc(s.end)}</p>
      ${s.speaker ? `<p><strong>${esc(s.speaker)}</strong></p>` : ''}
      ${s.cues ? `<p class="cue">${icon('bulb')}${esc(s.cues)}</p>` : ''}
      ${s.notes ? `<p class="muted">${esc(s.notes)}</p>` : ''}
      <a class="link" href="#/room/${esc(ev.id)}/${esc(room.id)}?d=${esc(s.date)}">Otwórz agendę sali ${icon('chevronRight')}</a>`,
    actions: [{ label: 'Edytuj', kind: 'ghost', onClick: () => { setTimeout(() => sessionSheet(ev, room, s, redraw), 240); } }]
  });
}

export function render({ el, params }) {
  const ev = resolveEvent(params.id);
  const header = () => setHeader({
    title: 'Teraz', sub: ev ? ev.name : '',
    actions: [{ id: 'mode', icon: mode === 'grid' ? 'list' : 'columns', label: mode === 'grid' ? 'Karty sal' : 'Siatka czasu' }, NIGHT_ACTION()],
    onAction: id => { if (id === 'mode') { mode = mode === 'grid' ? 'cards' : 'grid'; header(); drawAll(); } }
  });
  header();
  if (!ev) { noEvent(el); return; }
  const days = agendaDays(ev);
  const sc = bindScrubber(el, days, full => (full ? drawAll() : drawBody()));

  let firstGrid = true;
  function drawBody() {
    const st = scrubState(days);
    const body = el.querySelector('#now-body');
    if (!body) return;
    const wrapOld = el.querySelector('#grid-wrap');
    const keep = wrapOld ? { x: wrapOld.scrollLeft, y: wrapOld.scrollTop } : null;
    body.innerHTML = mode === 'grid' ? gridHtml(ev, st) : cardsHtml(ev, st);
    const wrap = el.querySelector('#grid-wrap');
    if (wrap) {
      if (keep && !firstGrid) { wrap.scrollLeft = keep.x; wrap.scrollTop = keep.y; }
      else {
        const line = wrap.querySelector('.now-line');
        if (line) wrap.scrollTop = Math.max(0, line.offsetTop - 120);
        firstGrid = false;
      }
    }
  }
  function drawAll() {
    const st = scrubState(days);
    el.innerHTML = `
      ${eventSwitcher(ev, '#/now/')}
      ${scrubberHtml(days, st)}
      <div class="seg">
        <button class="seg-btn ${mode === 'cards' ? 'on' : ''}" data-act="mode" data-mode="cards">Sale</button>
        <button class="seg-btn ${mode === 'grid' ? 'on' : ''}" data-act="mode" data-mode="grid">Siatka</button>
      </div>
      <div id="now-body"></div>`;
    firstGrid = true;
    drawBody();
  }

  el.onclick = e => {
    if (sc.handle(e)) return;
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'mode') { mode = t.dataset.mode; header(); drawAll(); return; }
    if (t.dataset.act === 'sess') {
      const room = ev.rooms.find(r => r.id === t.dataset.room);
      const s = room?.sessions.find(x => x.id === t.dataset.id);
      if (room && s) sessionInfo(ev, room, s, drawBody);
    }
  };
  el.oninput = sc.onInput;
  el.onchange = e => { handleEventSwitch(e); };

  drawAll();
  const timer = setInterval(() => {
    if (!scrubState(days).live || document.body.classList.contains('sheet-open')) return;
    const label = el.querySelector('[data-scrub-time]');
    const st = scrubState(days);
    if (label) label.textContent = fromMin(st.min);
    const range = el.querySelector('[data-scrub-range]');
    if (range) range.value = String(st.min - (st.min % 5));
    if (range) range.setAttribute('aria-valuetext', fromMin(st.min));
    drawBody();
  }, 20000);
  return () => clearInterval(timer);
}
