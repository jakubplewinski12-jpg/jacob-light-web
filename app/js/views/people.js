// "Gdzie kto jest" (everyone at the selected time) and "Mój plan" (personal plan).

import { esc, telHref, initials, fmtDT, parseDT, relTime, dtStr, splitDT, fmtDate, dateStr, minutesOfDay, toMin } from '../util.js';
import { icon } from '../icons.js';
import { eventDays, cursorDate, findMe, getSettings, setSetting, roomById, milestones } from '../store.js';
import { setHeader, NIGHT_ACTION, scrubState, scrubberHtml, bindScrubber, emptyState, select } from '../ui.js';
import { resolveEvent, eventSwitcher, handleEventSwitch, noEvent } from './common.js';
import { whereIs, personalPlan, vehicleOf, hotelRoomOf } from '../whereabouts.js';
import { roomSessionsOn, sessEnd } from '../timeline.js';

function crewDays(ev) {
  const set = new Set(eventDays(ev));
  for (const m of milestones(ev)) set.add(m.dt.split('T')[0]);
  return [...set].sort();
}

function segNav(ev, active) {
  return `<div class="seg">
    <a class="seg-btn ${active === 'all' ? 'on' : ''}" href="#/crew/${esc(ev.id)}">Wszyscy</a>
    <a class="seg-btn ${active === 'me' ? 'on' : ''}" href="#/me/${esc(ev.id)}">Mój plan</a>
  </div>`;
}

/* ---------- everyone ---------- */

export function render({ el, params }) {
  const ev = resolveEvent(params.id);
  setHeader({ title: 'Gdzie kto jest', sub: ev ? ev.name : '', actions: [NIGHT_ACTION()] });
  if (!ev) { noEvent(el); return; }
  const days = crewDays(ev);
  const sc = bindScrubber(el, days, full => (full ? drawAll() : drawBody()));
  const meId = findMe(ev)?.id;

  function bodyHtml() {
    if (!ev.crew.length) {
      return emptyState('users', 'Brak ekipy', 'Zaimportuj kartę wyjazdową albo dodaj osoby ręcznie.',
        `<a class="btn primary" href="#/import/trip?event=${esc(ev.id)}">${icon('route')}Importuj kartę</a>
         <a class="btn" href="#/event/${esc(ev.id)}?tab=crew">Dodaj ręcznie</a>`);
    }
    const at = cursorDate();
    const rows = ev.crew.map(p => ({ p, w: whereIs(ev, p, at) }));
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.w.kind}|${r.w.title}`;
      if (!groups.has(key)) groups.set(key, { w: r.w, items: [] });
      groups.get(key).items.push(r);
    }
    return [...groups.values()].map(g => `
      <section class="where-group">
        <div class="where-head">${icon(g.w.icon)}<strong>${esc(g.w.title)}</strong><span class="count">${g.items.length}</span></div>
        <div class="card list">${g.items.map(({ p, w }) => `
          <div class="list-row ${p.id === meId ? 'is-me' : ''}">
            <span class="avatar">${esc(initials(p.name))}</span>
            <span class="grow"><strong>${esc(p.name)}${p.id === meId ? ' <span class="badge soon">Ja</span>' : ''}</strong>
              <small class="muted">${esc([p.role, w.detail].filter(Boolean).join(' · '))}</small>
              ${w.next ? `<small class="muted">Następnie: ${esc(w.next.label)} – ${esc(fmtDT(w.next.dt))}</small>` : ''}</span>
            ${p.phone ? `<a class="icon-btn accent" href="${esc(telHref(p.phone))}" aria-label="Zadzwoń do ${esc(p.name)}">${icon('phone')}</a>` : ''}
          </div>`).join('')}</div>
      </section>`).join('');
  }
  function drawBody() {
    const b = el.querySelector('#crew-body');
    if (b) b.innerHTML = bodyHtml();
  }
  function drawAll() {
    el.innerHTML = `${eventSwitcher(ev, '#/crew/')}${segNav(ev, 'all')}${scrubberHtml(days, scrubState(days))}<div id="crew-body"></div>`;
    drawBody();
  }
  el.onclick = e => { sc.handle(e); };
  el.oninput = sc.onInput;
  el.onchange = e => { handleEventSwitch(e); };
  drawAll();
  const timer = setInterval(() => {
    const st = scrubState(days);
    if (!st.live || document.body.classList.contains('sheet-open')) return;
    drawAll();
  }, 30000);
  return () => clearInterval(timer);
}

/* ---------- me ---------- */

export function renderMe({ el, params, refresh }) {
  const ev = resolveEvent(params.id);
  setHeader({ title: 'Mój plan', sub: ev ? ev.name : '', actions: [NIGHT_ACTION()] });
  if (!ev) { noEvent(el); return; }
  const me = findMe(ev);

  el.onchange = e => {
    if (handleEventSwitch(e)) return;
    if (e.target.name === 'pick-me' && e.target.value) {
      const p = ev.crew.find(x => x.id === e.target.value);
      if (p) { setSetting('me', p.name); refresh(); }
    }
  };

  if (!me) {
    el.innerHTML = `${eventSwitcher(ev, '#/me/')}${segNav(ev, 'me')}
      <section class="card">
        <h3>Kim jesteś w tej ekipie?</h3>
        <p class="muted small">W Ustawieniach jako „ja” wpisane jest: <strong>${esc(getSettings().me || '—')}</strong>, ale nie ma takiej osoby w ekipie tego wydarzenia.</p>
        ${ev.crew.length
          ? `<label class="field"><span class="field-label">Wybierz siebie</span>${select('pick-me', [['', '— wybierz —'], ...ev.crew.map(p => [p.id, p.name])], '')}</label>`
          : `<a class="btn primary" href="#/event/${esc(ev.id)}?tab=crew">Dodaj ekipę</a>`}
      </section>`;
    return;
  }

  const draw = () => {
    const now = new Date();
    const w = whereIs(ev, me, now);
    const plan = personalPlan(ev, me);
    const nowS = dtStr(now);
    const room = roomById(ev, me.roomId);
    const veh = vehicleOf(ev, me.id);
    const hr = hotelRoomOf(ev, me.id);
    const today = dateStr(now);
    const mySessions = room ? roomSessionsOn(room, today) : [];
    const min = minutesOfDay(now);
    let markerDone = false;
    const planHtml = plan.map(it => {
      const past = it.dt < nowS;
      let marker = '';
      if (!past && !markerDone) { markerDone = true; marker = `<li class="plan-now"><span>teraz · ${esc(nowS.split('T')[1])}</span></li>`; }
      return `${marker}<li class="plan-item ${past ? 'past' : ''}">
        <span class="plan-time"><strong>${esc(splitDT(it.dt).time)}</strong><small>${esc(fmtDate(splitDT(it.dt).date, { weekday: true, short: true }))}</small></span>
        <span class="plan-ic">${icon(it.icon)}</span>
        <span class="grow"><strong>${esc(it.title)}</strong>${it.detail ? `<small class="muted">${esc(it.detail)}</small>` : ''}</span>
      </li>`;
    }).join('') + (markerDone ? '' : `<li class="plan-now"><span>teraz · ${esc(nowS.split('T')[1])}</span></li>`);

    el.innerHTML = `${eventSwitcher(ev, '#/me/')}${segNav(ev, 'me')}
      <section class="card me-card">
        <div class="me-top"><span class="avatar lg">${esc(initials(me.name))}</span>
          <div><h2>${esc(me.name)}</h2><p class="muted small">${esc(me.role || '')}</p></div></div>
        <div class="me-now">${icon(w.icon)}<div><span class="eyebrow">Teraz</span><strong>${esc(w.title)}</strong><small class="muted">${esc(w.detail || '')}</small></div></div>
        ${w.next ? `<div class="me-next"><span class="eyebrow">Następnie</span><strong>${esc(w.next.label)}</strong><span class="accent">${esc(relTime(parseDT(w.next.dt), now))}</span><small class="muted">${esc(fmtDT(w.next.dt))}</small></div>` : ''}
        <div class="me-facts">
          <span>${icon('door')}${esc(room ? room.name : 'bez sali')}</span>
          <span>${icon('bus')}${esc(veh ? veh.name : 'bez pojazdu')}</span>
          <span>${icon('bed')}${esc(hr ? 'pokój ' + hr.number : 'bez pokoju')}</span>
        </div>
      </section>
      ${mySessions.length ? `
        <div class="section-head"><h2 class="section-title">Dziś w: ${esc(room.name)}</h2><a class="link" href="#/room/${esc(ev.id)}/${esc(room.id)}">Agenda</a></div>
        <div class="card list">${mySessions.map(s => {
          const cur = toMin(s.start) <= min && min < sessEnd(s);
          const past = sessEnd(s) <= min;
          return `<div class="list-row ${cur ? 'current' : ''} ${past ? 'past' : ''}"><span class="time-col">${esc(s.start)}<small>${esc(s.end)}</small></span>
            <span class="grow"><strong>${esc(s.title)}</strong>${s.cues ? `<small class="cue">${icon('bulb')}${esc(s.cues)}</small>` : ''}</span></div>`;
        }).join('')}</div>` : ''}
      <h2 class="section-title">Plan</h2>
      ${plan.length ? `<ol class="plan">${planHtml}</ol>` : emptyState('calendar', 'Brak punktów planu', 'Dodaj calle, wyjazd i hotel w zakładce Ekipa.')}`;
  };
  draw();
  const timer = setInterval(() => { if (!document.body.classList.contains('sheet-open')) draw(); }, 30000);
  return () => clearInterval(timer);
}
