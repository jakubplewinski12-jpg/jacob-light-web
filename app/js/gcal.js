// Google Calendar sync: pushes an event's milestones (wyjazd, montaż, show, demontaż,
// powrót, calls…) to the user's primary Google Calendar. Re-syncing updates the same
// entries (stable ids), so changes in the app reach the calendar without duplicates.
//
// Redirect flow, not a popup: in an iPhone Home Screen app the Google popup cannot return
// to the app (white screen). The entries travel in OAuth `state`, so the page Google
// returns to can push them even when iOS opens it outside the app's own storage.

import { milestones } from './store.js';
import { addMinutesDT } from './util.js';

// public OAuth client id (project "Event Cal"); redirect URI = the app's URL below
const CLIENT_ID = '991935838270-8m5mv9klhvond8pv8aaetjgtrd3091kg.apps.googleusercontent.com';
const REDIRECT = 'https://jakubplewinski12-jpg.github.io/jacob-light-web/app/';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TZ = 'Europe/Warsaw';

// Google event ids: 5–1024 chars of base32hex (0-9a-v); a hex hash fits
async function gid(...parts) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return 'jl' + [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function entries(ev) {
  const place = [ev.venue, ev.address].filter(Boolean).join(', ');
  const ms = milestones(ev);
  const show = ms.find(m => m.kind === 'show'), showEnd = ms.find(m => m.kind === 'showend');
  const out = [];
  for (const m of ms) {
    if (m.kind === 'showend' && show) continue; // folded into the show block
    const end = m.kind === 'show' && showEnd ? showEnd.dt : addMinutesDT(m.dt, m.kind === 'show' ? 120 : 30);
    out.push({ i: await gid(ev.id, m.key), s: `${m.label} · ${ev.name}`, a: m.dt, b: end, l: place });
  }
  return out;
}

const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** Leaves the app for Google's consent page; the sync finishes in handleGoogleReturn(). */
export async function syncToGoogle(ev) {
  const list = await entries(ev);
  if (!list.length) throw new Error('Brak godzin do wysłania – uzupełnij harmonogram');
  const state = b64(JSON.stringify({ ev: ev.id, back: location.hash, e: list }));
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'token',
    scope: SCOPE, include_granted_scopes: 'true', state
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

async function push(token, list) {
  for (const e of list) {
    const body = {
      id: e.i, summary: e.s, location: e.l, description: 'Z aplikacji Event Cal – Jacob Light',
      start: { dateTime: e.a + ':00', timeZone: TZ }, end: { dateTime: e.b + ':00', timeZone: TZ }
    };
    const opts = m => ({ method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let res = await fetch(`${API}/${e.i}`, opts('PUT'));
    if (res.status === 404) res = await fetch(API, opts('POST'));
    if (!res.ok) throw new Error(`Google Calendar: błąd ${res.status}`);
  }
}

/** Called at startup. Returns null when this is not a return from Google, else a result. */
export async function handleGoogleReturn() {
  const h = location.hash;
  if (!/(^#|&)(access_token|error)=/.test(h.slice(1) ? '&' + h.slice(1) : '')) return null;
  const p = new URLSearchParams(h.slice(1));
  let st = {};
  try { st = JSON.parse(unb64(p.get('state') || '')); } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname + (st.back || '#/home'));
  if (p.get('error')) return { ok: false, msg: 'Google: ' + p.get('error') };
  try {
    await push(p.get('access_token'), st.e || []);
    return { ok: true, msg: `Zsynchronizowano z Google Kalendarzem (${(st.e || []).length})` };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}
