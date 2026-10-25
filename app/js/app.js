// Bootstrap + hash router.

import { handleGoogleReturn } from './gcal.js';
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
  // back from Google's consent page: push to the calendar before routing (the hash holds the token)
  const g = await handleGoogleReturn();
  if (g) setTimeout(() => toast(g.msg, g.ok ? '' : 'err'), 800);
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

  if ('serviceWorker' in navigator && location.protocol !== 'file:') setupUpdates();
  try {
    if (sessionStorage.getItem('updated')) { sessionStorage.removeItem('updated'); toast(`Zaktualizowano do wersji ${settings.APP_VERSION}`); }
  } catch { /* storage blocked */ }

  // Safari may evict script-written data of sites not used for a while (ITP, 7 days of
  // use); a Home Screen app gets its own counter and persist() is granted heuristically
  // mainly to installed apps. Ask once per start when running standalone – it is silent.
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone && navigator.storage?.persist) {
    navigator.storage.persisted().then(p => (p ? true : navigator.storage.persist())).catch(() => {});
  }
}

/* ---------- updates without reinstalling ----------
   Every deploy changes sw.js (its CACHE name is derived from the app files), the browser
   installs the new worker in the background, it takes over (skipWaiting + claim) and we
   reload into the new version. All data lives in IndexedDB, so a reload loses nothing –
   except a form being typed, so then we wait until the user leaves it. */

const busy = () => document.body.classList.contains('sheet-open') || /^#\/(new|import|event\/[^/]+\/edit)/.test(location.hash);

function setupUpdates() {
  const sw = navigator.serviceWorker;
  // the very first install takes control without replacing anything – skip only that one
  let skipNext = !sw.controller;
  let pending = false;

  const reloadNow = () => {
    try { sessionStorage.setItem('updated', '1'); } catch { /* ignore */ }
    location.reload();
  };
  const reloadWhenIdle = () => {
    if (!busy()) return reloadNow();
    if (pending) return;
    pending = true;
    toast('Pobrano nową wersję – zainstaluje się po zapisaniu formularza.');
    const tryLater = () => { if (!busy()) reloadNow(); };
    window.addEventListener('hashchange', tryLater);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reloadNow(); });
    new MutationObserver(tryLater).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  };
  sw.addEventListener('controllerchange', () => {
    if (skipNext) { skipNext = false; return; }
    reloadWhenIdle();
  });

  // updateViaCache 'none': always fetch sw.js from the network, not the 10-minute HTTP cache
  sw.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    // iOS keeps a Home Screen app suspended instead of reloading it, so check whenever it
    // comes back to the screen, and every 30 minutes while it stays open
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
    window.checkForUpdate = check;
  }).catch(err => console.warn('SW:', err));
}

boot();
