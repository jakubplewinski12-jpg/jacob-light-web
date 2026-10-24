// UI building blocks: header, bottom sheets, toasts, confirm, form fields,
// time scrubber, night mode.

import { esc, fmtDate, fromMin, dateStr, minutesOfDay } from './util.js';
import { icon, LOGO } from './icons.js';
import { cursor, getSettings, setSetting } from './store.js';

/* ---------- header ---------- */

let headerHandler = null;

export function initUi() {
  document.getElementById('topbar').addEventListener('click', e => {
    const b = e.target.closest('[data-hact]');
    if (b && headerHandler) headerHandler(b.dataset.hact, b);
  });
  applyTheme();
}

/**
 * actions: [{ id, icon, label }]; onAction(id) handles clicks.
 */
export function setHeader({ title = '', sub = '', back = '', brand = false, actions = [], onAction = null } = {}) {
  const left = back
    ? `<a class="icon-btn" href="${esc(back)}" aria-label="Wstecz">${icon('back')}</a>`
    : brand ? `<span class="brand" aria-hidden="true">${LOGO}</span>` : '';
  document.getElementById('topbar').innerHTML = `
    <div class="tb-left">${left}</div>
    <div class="tb-title">${title ? `<h1>${esc(title)}</h1>` : ''}${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    <div class="tb-right">${actions.map(a =>
      `<button class="icon-btn ${a.on ? 'on' : ''}" data-hact="${esc(a.id)}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${icon(a.icon)}</button>`).join('')}</div>`;
  headerHandler = id => {
    if (id === 'night') { toggleNight(); return; }
    if (onAction) onAction(id);
  };
}
export const NIGHT_ACTION = () => ({ id: 'night', icon: 'moon', label: 'Tryb nocny (czerwony)', on: getSettings().night });

/* ---------- theme ---------- */

export function applyTheme() {
  const night = !!getSettings().night;
  document.documentElement.dataset.theme = night ? 'night' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', night ? '#000000' : '#0A0A0A');
  document.querySelectorAll('[data-hact="night"]').forEach(b => b.classList.toggle('on', night));
}
export function toggleNight() {
  setSetting('night', !getSettings().night);
  applyTheme();
  toast(getSettings().night ? 'Tryb nocny włączony' : 'Tryb nocny wyłączony');
}

/* ---------- toast ---------- */

let toastTimer = null;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/* ---------- bottom sheet ---------- */

/**
 * actions: [{ label, kind: 'primary'|'danger'|'ghost', onClick(api) }]
 * onClick returning false keeps the sheet open.
 */
export function openSheet({ title = '', body = '', actions = [], onMount = null, onClose = null } = {}) {
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Zamknij">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
      ${actions.length ? `<div class="sheet-actions">${actions.map((a, i) =>
        `<button type="button" class="btn ${a.kind || ''}" data-sact="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  const opener = document.activeElement;
  root.appendChild(wrap);
  document.body.classList.add('sheet-open');
  // the page behind a modal must not be reachable by VoiceOver / keyboard
  const behind = [document.getElementById('app'), document.getElementById('tabbar')];
  behind.forEach(n => n && n.setAttribute('inert', ''));
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  // move focus into the dialog (not into a field – that would pop the iOS keyboard)
  wrap.querySelector('.sheet').setAttribute('tabindex', '-1');
  setTimeout(() => wrap.querySelector('.sheet')?.focus({ preventScroll: true }), 60);

  let closed = false;
  const onKey = e => { if (e.key === 'Escape') api.close(); };
  document.addEventListener('keydown', onKey);
  const api = {
    el: wrap.querySelector('.sheet'),
    body: wrap.querySelector('.sheet-body'),
    data: () => formData(wrap.querySelector('.sheet-body')),
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      wrap.classList.remove('open');
      setTimeout(() => {
        wrap.remove();
        if (!root.children.length) {
          document.body.classList.remove('sheet-open');
          behind.forEach(n => n && n.removeAttribute('inert'));
          if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
        }
      }, 220);
      if (onClose) onClose();
    }
  };
  wrap.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { api.close(); return; }
    const b = e.target.closest('[data-sact]');
    if (!b) return;
    const a = actions[Number(b.dataset.sact)];
    b.disabled = true;
    try {
      const res = a.onClick ? await a.onClick(api) : undefined;
      if (res !== false) api.close();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Błąd', 'err');
    } finally {
      b.disabled = false;
    }
  });
  if (onMount) onMount(api);
  return api;
}

export function confirmDialog(text, { ok = 'Usuń', danger = true, title = 'Na pewno?' } = {}) {
  return new Promise(resolve => {
    let answered = false;
    openSheet({
      title,
      body: `<p class="muted">${esc(text)}</p>`,
      actions: [
        { label: 'Anuluj', kind: 'ghost', onClick: () => { answered = true; resolve(false); } },
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

/* ---------- form helpers ---------- */

export function formData(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach(el => {
    const n = el.name;
    if (el.type === 'checkbox') {
      if ('multi' in el.dataset) { out[n] = out[n] || []; if (el.checked) out[n].push(el.value); }
      else out[n] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[n] = el.value;
    } else {
      out[n] = el.value.trim();
    }
  });
  return out;
}

export const field = (label, inner, hint = '') =>
  `<label class="field"><span class="field-label">${esc(label)}</span>${inner}${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}</label>`;

export const input = (name, value = '', { type = 'text', placeholder = '', attrs = '' } = {}) =>
  `<input class="input" type="${type}" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>`;

export const textarea = (name, value = '', { rows = 3, placeholder = '' } = {}) =>
  `<textarea class="input" name="${esc(name)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;

export const select = (name, options, value = '') =>
  `<select class="input" name="${esc(name)}">${options.map(([v, l]) =>
    `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

export function peoplePicker(name, crew, selected = [], label = 'Osoby') {
  if (!crew.length) return `<div class="field"><span class="field-label">${esc(label)}</span><p class="muted small">Brak ekipy – dodaj osoby w zakładce Ekipa.</p></div>`;
  return `<div class="field"><span class="field-label">${esc(label)}</span><div class="pick">${crew.map(p =>
    `<label class="pick-item"><input type="checkbox" name="${esc(name)}" value="${esc(p.id)}" data-multi ${selected.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}</div></div>`;
}

export const row2 = (a, b) => `<div class="row2">${a}${b}</div>`;

export function emptyState(ic, title, text = '', action = '') {
  return `<div class="empty">${icon(ic, 'empty-ic')}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

/* ---------- time scrubber (shared by "Teraz" and "Ekipa") ---------- */

export function scrubState(days) {
  const now = new Date();
  if (cursor.live) {
    return { date: dateStr(now), min: minutesOfDay(now), live: true };
  }
  return { date: cursor.date || days[0] || dateStr(now), min: cursor.min, live: false };
}

export function scrubberHtml(days, st) {
  const notToday = st.live && days.length && !days.includes(st.date);
  return `
  <section class="scrubber" aria-label="Wybór czasu">
    <div class="chips scroll-x">${days.map(d =>
      `<button class="chip ${!st.live && d === st.date ? 'on' : ''} ${d === dateStr(new Date()) ? 'today' : ''}" data-act="sc-day" data-date="${d}">${esc(fmtDate(d, { weekday: true, short: true }))}</button>`).join('')}
    </div>
    <div class="scrub-row">
      <button class="step-btn" data-act="sc-step" data-step="-15" aria-label="15 minut wcześniej">−15</button>
      <div class="scrub-time">
        <span class="big-time" data-scrub-time>${fromMin(st.min)}</span>
        <button class="live-pill ${st.live ? 'on' : ''}" data-act="sc-now">${st.live ? 'Na żywo' : 'Wróć do teraz'}</button>
      </div>
      <button class="step-btn" data-act="sc-step" data-step="15" aria-label="15 minut później">+15</button>
    </div>
    <input class="range" type="range" min="0" max="1435" step="5" value="${st.min - (st.min % 5)}" data-scrub-range aria-label="Godzina" aria-valuetext="${fromMin(st.min)}">
    ${notToday ? `<p class="small muted center">Dziś nic się nie dzieje w tym wydarzeniu – wybierz dzień powyżej.</p>` : ''}
  </section>`;
}

/**
 * Handles scrubber interactions inside `root`. onChange(full) is called after
 * each change; full=true means the scrubber itself must re-render.
 */
export function bindScrubber(root, days, onChange) {
  const handle = e => {
    const t = e.target.closest('[data-act]');
    if (!t) return false;
    const act = t.dataset.act;
    const st = scrubState(days);
    if (act === 'sc-day') {
      cursor.live = false; cursor.date = t.dataset.date; cursor.min = st.min;
      onChange(true); return true;
    }
    if (act === 'sc-step') {
      cursor.live = false; cursor.date = st.date;
      cursor.min = Math.max(0, Math.min(1435, st.min + Number(t.dataset.step)));
      onChange(true); return true;
    }
    if (act === 'sc-now') {
      cursor.live = true;
      onChange(true); return true;
    }
    return false;
  };
  const onInput = e => {
    if (!e.target.matches('[data-scrub-range]')) return;
    const st = scrubState(days);
    cursor.live = false;
    cursor.date = st.date;
    cursor.min = Number(e.target.value);
    const label = root.querySelector('[data-scrub-time]');
    if (label) label.textContent = fromMin(cursor.min);
    e.target.setAttribute('aria-valuetext', fromMin(cursor.min));
    const pill = root.querySelector('.live-pill');
    if (pill) { pill.classList.remove('on'); pill.textContent = 'Wróć do teraz'; }
    onChange(false);
  };
  return { handle, onInput };
}
