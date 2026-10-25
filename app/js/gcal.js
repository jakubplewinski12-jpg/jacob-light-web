// Google Calendar sync: pushes an event's milestones (wyjazd, montaż, show, demontaż,
// powrót, calls…) to the user's primary Google Calendar. Re-syncing updates the same
// entries (stable ids), so changes in the app reach the calendar without duplicates.

import { milestones } from './store.js';
import { addMinutesDT } from './util.js';

// public OAuth client id (project "Event Cal", authorised origin: the GitHub Pages site)
const CLIENT_ID = '991935838270-8m5mv9klhvond8pv8aaetjgtrd3091kg.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TZ = 'Europe/Warsaw';

let token = null, tokenExp = 0, gsiLoading = null;

function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return gsiLoading ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = ok;
    s.onerror = () => { gsiLoading = null; fail(new Error('Brak połączenia z Google')); };
    document.head.appendChild(s);
  });
}

async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  await loadGsi();
  return new Promise((ok, fail) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: r => {
        if (r.error) return fail(new Error('Google odmówił dostępu: ' + r.error));
        token = r.access_token; tokenExp = Date.now() + r.expires_in * 1000;
        ok(token);
      },
      error_callback: e => fail(new Error(e.type === 'popup_closed' ? 'Zamknięto okno logowania Google' : 'Logowanie Google nie powiodło się'))
    });
    client.requestAccessToken();
  });
}

// Google event ids: 5–1024 chars of base32hex (0-9a-v); a hex hash fits
async function gid(...parts) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return 'jl' + [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

function entries(ev) {
  const place = [ev.venue, ev.address].filter(Boolean).join(', ');
  const ms = milestones(ev);
  const out = [];
  const show = ms.find(m => m.kind === 'show'), showEnd = ms.find(m => m.kind === 'showend');
  for (const m of ms) {
    if (m.kind === 'showend' && show) continue; // folded into the show block
    const end = m.kind === 'show' && showEnd ? showEnd.dt : addMinutesDT(m.dt, m.kind === 'show' ? 120 : 30);
    out.push({ key: m.key, summary: `${m.label} · ${ev.name}`, start: m.dt, end, location: place });
  }
  return out;
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { token = null; throw new Error('Sesja Google wygasła – spróbuj ponownie'); }
  return res;
}

/** Creates or updates the event's entries in Google Calendar. Returns the number synced. */
export async function syncToGoogle(ev) {
  await getToken();
  const list = entries(ev);
  for (const e of list) {
    const id = await gid(ev.id, e.key);
    const body = {
      id, summary: e.summary, location: e.location,
      description: 'Z aplikacji Event Cal – Jacob Light',
      start: { dateTime: e.start + ':00', timeZone: TZ },
      end: { dateTime: e.end + ':00', timeZone: TZ }
    };
    let res = await call('PUT', `${API}/${id}`, body);
    if (res.status === 404) res = await call('POST', API, body);
    if (!res.ok) throw new Error(`Google Calendar: błąd ${res.status}`);
  }
  return list.length;
}
