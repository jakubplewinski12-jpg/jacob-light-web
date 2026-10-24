// Service worker: offline app shell + pdf.js from CDN.
// Bump CACHE when shipping changes so phones pick up the new version.
const CACHE = 'eventcal-v1.2.0';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-maskable-512.png',
  './js/app.js',
  './js/ai.js',
  './js/db.js',
  './js/export.js',
  './js/icons.js',
  './js/parse-common.js',
  './js/parser-agenda.js',
  './js/parser-trip.js',
  './js/pdf.js',
  './js/seed.js',
  './js/store.js',
  './js/templates.js',
  './js/textlayout.js',
  './js/timeline.js',
  './js/ui.js',
  './js/util.js',
  './js/whereabouts.js',
  './js/views/checklist.js',
  './js/views/common.js',
  './js/views/crew-trip.js',
  './js/views/event-edit.js',
  './js/views/event-rooms.js',
  './js/views/event.js',
  './js/views/events.js',
  './js/views/home.js',
  './js/views/importer.js',
  './js/views/now.js',
  './js/views/people.js',
  './js/views/settings.js'
];

const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// Install: download the whole shell fresh (cache: 'reload' skips the HTTP cache, otherwise
// a "new" version could be assembled from stale files). The app is a set of ES modules that
// import each other, so they must always come from ONE version – that is why the shell is
// served cache-first and only replaced as a whole when CACHE changes.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    // CDN libs are best-effort: a failure must not block installation
    await Promise.all(CDN.map(url => cache.add(new Request(url, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // keep pdf.js from the previous cache instead of downloading it again
    const old = keys.filter(k => k.startsWith('eventcal-') && k !== CACHE);
    const cache = await caches.open(CACHE);
    for (const k of old) {
      const prev = await caches.open(k);
      for (const url of CDN) {
        if (!(await cache.match(url))) { const hit = await prev.match(url); if (hit) await cache.put(url, hit); }
      }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // e.g. POST to api.anthropic.com goes straight to network
  const url = new URL(req.url);

  // pdf.js from CDN (versioned URL = immutable): cache first, match ignoring CORS mode
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req.url, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(req).catch(() => new Response('Offline', { status: 503 }));
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
