// Bootstrap + hash router.

import { loadAll, getSettings, setSetting, state } from './store.js';
import { seedDemo } from './seed.js';
import { initUi, setHeader, toast } from './ui.js';
import { esc } from './util.js';
import { icon } from './icons.js';
import * as home from './views/home.js';
import * as events from './views/events.js';
import * as eventView from './views/event.js';
import * as eventEdit from './views/event-edit.js';
import * as rooms from './views/event-rooms.js';
import * as now from './views/now.js';
import * as people from './views/people.js';
import * as importer from './views/importer.js';
import * as settings from './views/settings.js';

const routes = [
  { re: /^home$/, view: home.render, tab: 'home' },
  { re: /^events$/, view: events.render, tab: 'events' },
  { re: /^search$/, view: events.renderSearch, tab: 'events' },
  { re: /^new$/, view: eventEdit.render, tab: 'events' },
  { re: /^event\/([^/]+)$/, view: eventView.render, tab: 'events', keys: ['id'] },
  { re: /^event\/([^/]+)\/edit$/, view: eventEdit.render, tab: 'events', keys: ['id'] },
  { re: /^room\/([^/]+)\/([^/]+)$/, view: rooms.renderRoom, tab: 'events', keys: ['id', 'roomId'] },
  { re: /^now(?:\/([^/]+))?$/, view: now.render, tab: 'now', keys: ['id'] },
  { re: /^crew(?:\/([^/]+))?$/, view: people.render, tab: 'crew', keys: ['id'] },
  { re: /^me(?:\/([^/]+))?$/, view: people.renderMe, tab: 'crew', keys: ['id'] },
  { re: /^import\/(agenda|trip)$/, view: importer.render, tab: 'events', keys: ['kind'] },
  { re: /^settings$/, view: settings.render, tab: 'settings' }
];

let cleanup = null;
let navigated = false; // don't steal focus on the very first render

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  return { path: path || 'home', query: Object.fromEntries(new URLSearchParams(qs)) };
}

function setTab(tab) {
  document.querySelectorAll('#tabbar [data-tab]').forEach(a => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function route(keepScroll = false) {
  const { path, query } = parseHash();
  let match = null;
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      (r.keys || []).forEach((k, i) => { params[k] = m[i + 1] ? decodeURIComponent(m[i + 1]) : ''; });
      match = { r, params };
      break;
    }
  }
  if (!match) { location.replace('#/home'); return; }

  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  const main = document.getElementById('view');
  main.onclick = null; main.oninput = null; main.onchange = null; main.onsubmit = null;
  document.querySelectorAll('.sheet-wrap').forEach(s => s.remove());
  document.body.classList.remove('sheet-open');
  document.querySelectorAll('[inert]').forEach(n => n.removeAttribute('inert'));
  if (!keepScroll) window.scrollTo(0, 0);
  setTab(match.r.tab);

  try {
    const res = await match.r.view({ el: main, params: match.params, query, refresh });
    cleanup = typeof res === 'function' ? res : null;
    // screen readers: announce the new screen (title + move focus to the content)
    const h1 = document.querySelector('#topbar h1');
    document.title = h1 && h1.textContent !== 'Event Cal' ? `${h1.textContent} – Event Cal` : 'Event Cal – Jacob Light';
    if (!keepScroll && navigated) main.focus({ preventScroll: true });
    navigated = true;
  } catch (e) {
    console.error(e);
    setHeader({ title: 'Błąd', back: '#/home' });
    main.innerHTML = `<div class="empty">${icon('alert', 'empty-ic')}<h3>Coś poszło nie tak</h3><p>${esc(e.message || e)}</p><a class="btn" href="#/home">Start</a></div>`;
  }
}

function refresh() {
  const y = window.scrollY;
  route(true).then(() => window.scrollTo(0, y));
}

async function boot() {
  initUi();
  try {
    await loadAll();
    if (!getSettings().seeded) {
      if (!state.events.length) await seedDemo();
      setSetting('seeded', true);
    }
  } catch (e) {
    console.error(e);
    toast('Nie udało się otworzyć bazy danych (tryb prywatny?)', 'err');
  }
  window.addEventListener('hashchange', () => route());
  await route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
    // the shell is cache-first: a new version takes effect after a restart, say so
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Pobrano nową wersję aplikacji – zamknij ją i otwórz ponownie.');
    });
  }

  // Safari may evict script-written data of sites not used for a while (ITP, 7 days of
  // use); a Home Screen app gets its own counter and persist() is granted heuristically
  // mainly to installed apps. Ask once per start when running standalone – it is silent.
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone && navigator.storage?.persist) {
    navigator.storage.persisted().then(p => (p ? true : navigator.storage.persist())).catch(() => {});
  }
}

boot();
