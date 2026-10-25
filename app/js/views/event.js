// Event detail with tabs: Info, Sale, Ekipa (crew + trip), Lista (checklist).

import { syncToGoogle } from '../gcal.js';
import { esc, fmtRange, fmtDT, mapsHref, telHref, uid, money, grossOf } from '../util.js';
import { icon } from '../icons.js';
import { getEvent, saveEvent, deleteEvent, touchEvent, getFile, deleteFile } from '../store.js';
import { setHeader, openSheet, confirmDialog, toast, field, input, emptyState } from '../ui.js';
import { statusBadge } from './common.js';
import { exportIcs, shareEvent } from '../export.js';
import * as roomsTab from './event-rooms.js';
import * as crewTab from './crew-trip.js';
import * as listTab from './checklist.js';
import { openTripSheetDialog } from './trip-pdf.js';

const TABS = [['info', 'Info'], ['rooms', 'Sale'], ['crew', 'Ekipa'], ['list', 'Lista']];

function timeTile(label, v) {
  return `<div class="tile"><span class="eyebrow">${label}</span><strong>${v ? esc(fmtDT(v)) : '—'}</strong></div>`;
}

function infoHtml(ev) {
  const place = [ev.venue, ev.address].filter(Boolean).join(', ');
  return `
  <section class="card hero">
    <div class="ev-top"><span class="tag">${esc(ev.type)}</span>${statusBadge(ev)}</div>
    <h2>${esc(ev.name)}</h2>
    <p class="muted">${esc(fmtRange(ev.startDate, ev.endDate))}</p>
    ${place ? `<a class="info-line" href="${esc(mapsHref(place))}" target="_blank" rel="noopener">${icon('pin')}<span>${esc(place)}</span></a>` : ''}
    ${ev.client ? `<div class="info-line">${icon('user')}<span>${esc(ev.client)}</span></div>` : ''}
  </section>

  <div class="btn-grid">
    <a class="btn primary" href="#/now/${esc(ev.id)}">${icon('clock')}Teraz</a>
    <a class="btn" href="#/me/${esc(ev.id)}">${icon('user')}Mój plan</a>
    <a class="btn" href="#/crew/${esc(ev.id)}">${icon('users')}Gdzie kto jest</a>
    <a class="btn" href="#/event/${esc(ev.id)}?tab=rooms">${icon('door')}Sale (${ev.rooms.length})</a>
  </div>

  <section class="tiles">
    ${timeTile('Wyjazd', ev.trip.departure.dt)}${timeTile('Montaż', ev.loadIn)}
    ${timeTile('Start show', ev.showStart)}${timeTile('Koniec show', ev.showEnd)}
    ${timeTile('Demontaż', ev.loadOut)}${timeTile('Powrót', ev.trip.ret.dt)}
  </section>

  <h2 class="section-title">Stawka</h2>
  ${ev.fee.net == null
    ? `<a class="card plain fee-empty" href="#/event/${esc(ev.id)}/edit">${icon('plus')}<span class="grow">Dodaj stawkę netto / brutto</span>${icon('chevronRight', 'chev')}</a>`
    : `<a class="card fee" href="#/event/${esc(ev.id)}/edit" aria-label="Edytuj stawkę">
      <div class="fee-row"><span class="eyebrow">Netto</span><strong>${esc(money(ev.fee.net))}</strong></div>
      <div class="fee-row"><span class="eyebrow">Brutto${ev.fee.vat ? ` (VAT ${ev.fee.vat}%)` : ' (zw.)'}</span><strong class="accent">${esc(money(grossOf(ev.fee.net, ev.fee.vat)))}</strong></div>
      <span class="badge ${ev.fee.paid ? 'ok' : 'warn'}">${ev.fee.paid ? 'Opłacone' : 'Do zapłaty'}</span>
    </a>`}

  <div class="section-head"><h2 class="section-title">Kontakty</h2><button class="link" data-act="contact-add">${icon('plus')}Dodaj</button></div>
  ${ev.contacts.length ? `<div class="card list">${ev.contacts.map(c => `
    <div class="list-row">
      <button class="grow plain" data-act="contact-edit" data-id="${esc(c.id)}">
        <strong>${esc(c.name)}</strong><small class="muted">${esc([c.role, c.phone, c.email].filter(Boolean).join(' · '))}</small>
      </button>
      ${c.phone ? `<a class="icon-btn accent" href="${esc(telHref(c.phone))}" aria-label="Zadzwoń">${icon('phone')}</a>` : ''}
    </div>`).join('')}</div>` : '<p class="muted small pad">Brak kontaktów (producent, techniczny obiektu…).</p>'}

  ${ev.notes ? `<h2 class="section-title">Notatki</h2><div class="card notes">${esc(ev.notes)}</div>` : ''}

  ${ev.files.length ? `<h2 class="section-title">Pliki</h2><div class="card list">${ev.files.map(f => `
    <button class="list-row plain" data-act="file-open" data-id="${esc(f.id)}">
      ${icon('file')}<span class="grow"><strong>${esc(f.name)}</strong><small class="muted">${f.kind === 'trip' ? 'Karta wyjazdowa' : 'Agenda'} · ${Math.max(1, Math.round(f.size / 1024))} kB</small></span>${icon('chevronRight', 'chev')}
    </button>`).join('')}</div>` : ''}

  <h2 class="section-title">Akcje</h2>
  <div class="card list">
    <a class="list-row" href="#/import/agenda?event=${esc(ev.id)}">${icon('file')}<span class="grow">Importuj agendę (PDF / tekst)</span>${icon('chevronRight', 'chev')}</a>
    <a class="list-row" href="#/import/trip?event=${esc(ev.id)}">${icon('route')}<span class="grow">Importuj kartę wyjazdową</span>${icon('chevronRight', 'chev')}</a>
    <button class="list-row plain" data-act="trip-pdf">${icon('download')}<span class="grow">Pobierz kartę wyjazdową (PDF)</span>${icon('chevronRight', 'chev')}</button>
    <button class="list-row plain" data-act="gcal">${icon('refresh')}<span class="grow">Synchronizuj z Google Kalendarzem</span></button>
    <button class="list-row plain" data-act="ics">${icon('calendar')}<span class="grow">Eksportuj do kalendarza (.ics)</span></button>
    <button class="list-row plain" data-act="share">${icon('share')}<span class="grow">Udostępnij podsumowanie</span></button>
    <a class="list-row" href="#/event/${esc(ev.id)}/edit">${icon('edit')}<span class="grow">Edytuj dane wydarzenia</span>${icon('chevronRight', 'chev')}</a>
    <button class="list-row plain danger" data-act="delete">${icon('trash')}<span class="grow">Usuń wydarzenie</span></button>
  </div>`;
}

function contactSheet(ev, c, done) {
  const isNew = !c;
  c = c || { id: uid('k_'), name: '', role: '', phone: '', email: '' };
  const actions = [];
  if (!isNew) actions.push({ label: 'Usuń', kind: 'danger', onClick: async () => { ev.contacts = ev.contacts.filter(x => x.id !== c.id); await done(); } });
  actions.push({
    label: 'Zapisz', kind: 'primary', onClick: async api => {
      const d = api.data();
      if (!d.name) { toast('Podaj nazwę', 'err'); return false; }
      Object.assign(c, d);
      if (isNew) ev.contacts.push(c);
      await done();
    }
  });
  openSheet({
    title: isNew ? 'Nowy kontakt' : 'Kontakt',
    body: field('Imię i nazwisko / nazwa', input('name', c.name)) + field('Funkcja', input('role', c.role, { placeholder: 'np. Kierownik techniczny obiektu' }))
      + field('Telefon', input('phone', c.phone, { type: 'tel' })) + field('E-mail', input('email', c.email, { type: 'email' })),
    actions
  });
}

async function openFile(ev, id, done) {
  const f = await getFile(id);
  if (!f) { toast('Pliku nie ma już w pamięci', 'err'); return; }
  const url = URL.createObjectURL(new Blob([f.data], { type: f.type || 'application/pdf' }));
  openSheet({
    title: f.name,
    body: `<p class="muted small">Zapisany ${new Date(f.createdAt).toLocaleString('pl-PL')} · ${Math.round(f.size / 1024)} kB</p>
      <a class="btn primary block" href="${url}" target="_blank" rel="noopener">${icon('eye')}Otwórz PDF</a>`,
    actions: [{
      label: 'Usuń plik', kind: 'danger', onClick: async () => {
        await deleteFile(id);
        ev.files = ev.files.filter(x => x.id !== id);
        await done();
      }
    }],
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000)
  });
}

export function render({ el, params, query }) {
  const ev = getEvent(params.id);
  if (!ev) {
    setHeader({ title: 'Wydarzenie', back: '#/events' });
    el.innerHTML = emptyState('alert', 'Nie znaleziono wydarzenia', 'Mogło zostać usunięte.', '<a class="btn" href="#/events">Wróć do listy</a>');
    return;
  }
  touchEvent(ev.id);
  const tab = TABS.some(t => t[0] === query.tab) ? query.tab : 'info';

  setHeader({
    title: ev.name, sub: fmtRange(ev.startDate, ev.endDate), back: '#/events',
    actions: [{ id: 'share', icon: 'share', label: 'Udostępnij' }, { id: 'edit', icon: 'edit', label: 'Edytuj' }],
    onAction: async id => {
      if (id === 'edit') location.hash = `#/event/${ev.id}/edit`;
      if (id === 'share') shareResult(await shareEvent(ev));
    }
  });

  const draw = () => {
    const body = tab === 'rooms' ? roomsTab.html(ev)
      : tab === 'crew' ? crewTab.html(ev, { mode: 'event' })
      : tab === 'list' ? listTab.html(ev)
      : infoHtml(ev);
    el.innerHTML = `
      <nav class="seg sticky-seg" aria-label="Sekcje wydarzenia">${TABS.map(([k, l]) =>
        `<a class="seg-btn ${k === tab ? 'on' : ''}" href="#/event/${esc(ev.id)}?tab=${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div class="tab-body">${body}</div>`;
  };
  const ctx = {
    ev,
    async save() { await saveEvent(ev); const y = window.scrollY; draw(); window.scrollTo(0, y); },
    redraw() { const y = window.scrollY; draw(); window.scrollTo(0, y); }
  };

  el.onclick = async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (tab === 'info') {
      if (act === 'contact-add') return contactSheet(ev, null, ctx.save);
      if (act === 'contact-edit') return contactSheet(ev, ev.contacts.find(c => c.id === t.dataset.id), ctx.save);
      if (act === 'file-open') return openFile(ev, t.dataset.id, ctx.save);
      if (act === 'share') return shareResult(await shareEvent(ev));
      if (act === 'trip-pdf') return openTripSheetDialog(ev);
      if (act === 'gcal') {
        try { toast('Łączę z Google…'); const n = await syncToGoogle(ev); toast(`Zsynchronizowano z Google Kalendarzem (${n})`); }
        catch (e) { toast(e.message, 'err'); }
        return;
      }
      if (act === 'ics') {
        const r = await exportIcs(ev);
        if (r === 'downloaded') toast('Plik .ics pobrany – otwórz go, by dodać do Kalendarza');
        return;
      }
      if (act === 'delete') {
        if (await confirmDialog(`Usunąć „${ev.name}” razem z agendą, ekipą i plikami? Tego nie da się cofnąć.`)) {
          await deleteEvent(ev.id);
          toast('Wydarzenie usunięte');
          location.hash = '#/events';
        }
        return;
      }
    }
    if (tab === 'rooms') return roomsTab.handle(act, t, ctx);
    if (tab === 'crew') return crewTab.handle(act, t, ctx);
    if (tab === 'list') return listTab.handle(act, t, ctx);
  };
  el.onchange = e => { if (tab === 'list') listTab.onChange(e, ctx); };

  draw();
}

function shareResult(r) {
  if (r === 'copied') toast('Podsumowanie skopiowane do schowka');
  else if (r === 'failed') toast('Nie udało się udostępnić', 'err');
}
