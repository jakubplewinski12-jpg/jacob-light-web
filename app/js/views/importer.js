// Import flow for agendas and trip sheets:
// source (PDF or pasted text) -> heuristic or AI parse -> "Sprawdź co rozpoznałem" -> save.

import { esc, uid, todayStr, isDate, normalize, deepClone, fmtDate, readFileAsArrayBuffer, addDays, pl, plural } from '../util.js';
import { icon } from '../icons.js';
import {
  state, getEvent, activeEvent, saveEvent, newEvent, normalizeEvent, normalizeRoom, normalizePerson,
  eventDays, saveFile
} from '../store.js';
import { setHeader, toast, field, select, emptyState, confirmDialog } from '../ui.js';
import { extractPdf } from '../pdf.js';
import { groupLines, linesToText } from '../textlayout.js';
import { parseAgendaPages, parsePastedAgenda, normalizeAgenda } from '../parser-agenda.js';
import { parseTripText, normalizeTripImport } from '../parser-trip.js';
import { aiParse, hasAiKey } from '../ai.js';
import { SAMPLE_AGENDA_TABLE, SAMPLE_AGENDA_LIST, SAMPLE_TRIP } from '../templates.js';
import * as crewTab from './crew-trip.js';

let S = null; // import session survives re-renders

function fresh(kind, eventId) {
  const ev = getEvent(eventId);
  return {
    kind, eventId: ev ? ev.id : '__new', step: 'source', busy: '',
    text: '', pages: null, pagesText: '', fileName: '', fileBuf: null, numPages: 0,
    defaultDate: ev ? (kind === 'trip' && ev.trip.departure.dt ? ev.trip.departure.dt.slice(0, 10) : ev.startDate) : todayStr(),
    newName: '', draft: null, method: '', mode: 'merge', openRoom: 0
  };
}

const title = kind => (kind === 'agenda' ? 'Import agendy' : 'Import karty wyjazdowej');

export function render({ el, params, query }) {
  const kind = params.kind === 'trip' ? 'trip' : 'agenda';
  const wanted = query.event && getEvent(query.event) ? query.event : null;
  // from the Start screen (?new=1) a document is a NEW event by default – it used to be
  // merged silently into whatever event was active (e.g. the demo conference)
  const wantNew = query.new === '1';
  if (!S || S.kind !== kind || (wanted && wanted !== S.eventId) || (wantNew && S.eventId !== '__new' && S.step === 'source')) {
    S = fresh(kind, wantNew ? null : (wanted || activeEvent()?.id));
  }
  const back = S.eventId !== '__new' ? `#/event/${S.eventId}` : '#/home';

  const draw = () => {
    setHeader({
      title: S.step === 'review' ? 'Sprawdź co rozpoznałem' : title(kind),
      sub: S.step === 'review' ? S.method : '',
      back,
      actions: [{ id: 'reset', icon: 'refresh', label: 'Zacznij od nowa' }],
      onAction: id => { if (id === 'reset') { S = fresh(kind, S.eventId); draw(); } }
    });
    el.innerHTML = S.step === 'review'
      ? (kind === 'agenda' ? agendaReviewHtml() : tripReviewHtml())
      : sourceHtml(kind);
    if (S.busy) el.insertAdjacentHTML('beforeend', `<div class="busy"><div class="spinner"></div><p>${esc(S.busy)}</p></div>`);
  };

  /* ---------- actions ---------- */

  const year = () => Number((isDate(S.defaultDate) ? S.defaultDate : todayStr()).slice(0, 4));
  const targetEvent = () => (S.eventId !== '__new' ? getEvent(S.eventId) : null);

  const toReview = raw => {
    if (kind === 'agenda') {
      S.draft = normalizeAgenda(raw, { defaultDate: S.defaultDate });
      const n = S.draft.rooms.reduce((a, r) => a + r.sessions.length, 0);
      if (!n && !S.draft.rooms.length) { toast('Nie rozpoznałem żadnych sesji – sprawdź tekst', 'err'); return; }
    } else {
      const ev = targetEvent();
      const { crew, trip } = normalizeTripImport(raw, ev, S.defaultDate);
      S.draft = { id: ev ? ev.id : 'new', crew, trip, rooms: ev ? ev.rooms : [] };
    }
    S.step = 'review';
    S.openRoom = 0;
    window.scrollTo(0, 0);
  };

  const parseHeuristic = () => {
    if (!S.text.trim()) { toast('Wybierz PDF albo wklej tekst', 'err'); return; }
    if (kind === 'agenda') {
      const useCols = S.pages && S.text === S.pagesText;
      const raw = useCols ? parseAgendaPages(S.pages, { year: year() }) : parsePastedAgenda(S.text, { year: year() });
      S.method = `Heurystyka: ${raw.method}`;
      toReview(raw);
    } else {
      S.method = 'Heurystyka: sekcje, telefony, słowa kluczowe';
      toReview(parseTripText(S.text, { year: year() }));
    }
    draw();
  };

  const parseAi = async () => {
    if (!S.text.trim()) { toast('Wybierz PDF albo wklej tekst', 'err'); return; }
    const ev = targetEvent();
    S.busy = 'Analizuję z AI… (to może potrwać do minuty)';
    draw();
    try {
      const raw = await aiParse(kind, S.text, {
        eventName: ev?.name || S.newName, defaultDate: S.defaultDate, rooms: ev ? ev.rooms.map(r => r.name) : []
      });
      S.method = 'AI (Claude)';
      S.busy = '';
      toReview(raw);
    } catch (e) {
      S.busy = '';
      toast(e.message || 'Błąd AI', 'err');
    }
    draw();
  };

  const loadPdf = async file => {
    if (!file) return;
    S.busy = 'Czytam PDF…';
    draw();
    try {
      const buf = await readFileAsArrayBuffer(file);
      const { pages, numPages } = await extractPdf(buf, (p, n) => {
        const b = el.querySelector('.busy p');
        if (b) b.textContent = `Czytam PDF… strona ${p}/${n}`;
      });
      const text = linesToText(groupLines(pages));
      S.busy = '';
      if (!text.trim()) {
        toast('Ten PDF nie zawiera tekstu (skan?). Wklej tekst ręcznie.', 'err');
        draw();
        return;
      }
      Object.assign(S, { pages, pagesText: text, text, fileName: file.name, fileBuf: buf, numPages });
      toast(`Wczytano ${numPages} str.`);
    } catch (e) {
      console.error(e);
      S.busy = '';
      toast(e.message || 'Nie udało się odczytać PDF', 'err');
    }
    draw();
  };

  const saveAgenda = async () => {
    const d = S.draft;
    const rooms = d.rooms.filter(r => r.name.trim() || r.sessions.length);
    if (!rooms.length) { toast('Brak sal do zapisania', 'err'); return; }
    const dates = rooms.flatMap(r => r.sessions.map(s => s.date)).filter(isDate).sort();
    let ev = targetEvent();
    ev = ev ? deepClone(ev) : newEvent({
      name: S.newName || (S.fileName ? S.fileName.replace(/\.pdf$/i, '') : 'Nowe wydarzenie'),
      startDate: dates[0] || S.defaultDate, endDate: dates[dates.length - 1] || S.defaultDate
    });
    const clean = rooms.map(r => normalizeRoom({ ...r, name: r.name.trim() || 'Sala', sessions: r.sessions }));
    if (S.mode === 'replace') {
      const oldNames = Object.fromEntries(ev.rooms.map(r => [r.id, normalize(r.name)]));
      // keep the lighting cues / notes typed by hand for sessions that are still there
      // (same room name + day + start) – "replace" must not wipe a night of programming notes
      let kept = 0;
      for (const r of clean) {
        const old = ev.rooms.find(x => normalize(x.name) === normalize(r.name));
        if (!old) continue;
        if (old.contacts?.length && !r.contacts.length) r.contacts = old.contacts;
        for (const s of r.sessions) {
          const o = old.sessions.find(x => x.date === s.date && x.start === s.start);
          if (!o) continue;
          if (o.cues && !s.cues) { s.cues = o.cues; kept++; }
          if (o.notes && !s.notes) s.notes = o.notes;
        }
      }
      const lostCues = ev.rooms.reduce((n, r) => n + r.sessions.filter(x => x.cues).length, 0) - kept;
      if (lostCues > 0 && !(await confirmDialog(`Nowa agenda nie zawiera ${pl(lostCues, "sesji", "sesji", "sesji")} z wpisanymi cue – stracisz je. Zastąpić mimo to?`, { ok: 'Zastąp' }))) return;
      ev.rooms = clean;
      ev.crew.forEach(p => {
        const match = clean.find(r => normalize(r.name) === oldNames[p.roomId]);
        p.roomId = match ? match.id : '';
      });
    } else {
      for (const r of clean) {
        const ex = ev.rooms.find(x => normalize(x.name) === normalize(r.name));
        if (!ex) { ev.rooms.push(r); continue; }
        for (const s of r.sessions) {
          if (!ex.sessions.some(x => x.date === s.date && x.start === s.start && normalize(x.title) === normalize(s.title))) ex.sessions.push(s);
        }
        ex.sessions.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      }
    }
    if (dates.length) {
      if (dates[0] < ev.startDate) ev.startDate = dates[0];
      if (dates[dates.length - 1] > ev.endDate) ev.endDate = dates[dates.length - 1];
    }
    await attachFile(ev);
    const saved = normalizeEvent(ev);
    await saveEvent(saved);
    S = null;
    toast(`Zapisano ${pl(clean.length, "salę", "sale", "sal")}`);
    location.hash = `#/event/${saved.id}?tab=rooms`;
  };

  const saveTrip = async () => {
    const d = S.draft;
    let ev = targetEvent();
    ev = ev ? deepClone(ev) : newEvent({
      name: S.newName || (S.fileName ? S.fileName.replace(/\.pdf$/i, '') : 'Nowy wyjazd'),
      startDate: S.defaultDate, endDate: S.defaultDate
    });
    for (const p of d.crew) {
      if (p._roomName && !p.roomId) {
        let room = ev.rooms.find(r => normalize(r.name) === normalize(p._roomName));
        if (!room) { room = { id: uid('r_'), name: p._roomName, sessions: [] }; ev.rooms.push(room); }
        p.roomId = room.id;
      }
      delete p._roomName;
    }
    ev.crew = d.crew.map(normalizePerson);
    const t = d.trip, o = ev.trip;
    ev.trip = {
      departure: t.departure.dt ? t.departure : o.departure,
      arrival: t.arrival.dt ? t.arrival : o.arrival,
      ret: t.ret.dt ? t.ret : o.ret,
      vehicles: t.vehicles.length ? t.vehicles : o.vehicles,
      hotel: t.hotel.name || t.hotel.address ? t.hotel : o.hotel,
      hotelRooms: t.hotelRooms.length ? t.hotelRooms : o.hotelRooms,
      calls: t.calls.length ? t.calls : o.calls,
      notes: t.notes && t.notes !== o.notes ? [o.notes, t.notes].filter(Boolean).join('\n') : o.notes
    };
    await attachFile(ev);
    const saved = normalizeEvent(ev);
    await saveEvent(saved);
    S = null;
    toast('Karta wyjazdowa zapisana');
    location.hash = `#/event/${saved.id}?tab=crew`;
  };

  const attachFile = async ev => {
    if (!S.fileBuf) return;
    try {
      const id = await saveFile(ev.id, S.fileName, S.fileBuf);
      ev.files.push({ id, name: S.fileName, kind, size: S.fileBuf.byteLength, addedAt: Date.now() });
    } catch (e) {
      console.warn('PDF nie został zapisany', e);
    }
  };

  /* ---------- events ---------- */

  const onField = e => {
    const t = e.target;
    if (t.id === 'src-text') { S.text = t.value; return; }
    if (t.id === 'new-name') { S.newName = t.value; return; }
    if (t.id === 'def-date') { S.defaultDate = t.value; return; }
    if (t.id === 'target' && e.type === 'change') {
      const ev = getEvent(t.value);
      S.eventId = ev ? ev.id : '__new';
      if (ev) S.defaultDate = ev.startDate;
      draw();
      return;
    }
    if (t.name === 'mode') { S.mode = t.value; return; }
    if (S.step === 'review' && kind === 'agenda' && t.dataset.f) {
      const r = S.draft.rooms[Number(t.dataset.r)];
      if (!r) return;
      if (t.dataset.s == null) { r[t.dataset.f] = t.value; return; }
      const s = r.sessions[Number(t.dataset.s)];
      if (!s) return;
      s[t.dataset.f] = t.value;
      if (t.dataset.f === 'end') s.guessedEnd = false;
    }
  };
  el.oninput = onField;
  el.onchange = e => {
    if (e.target.id === 'pdf-input') { loadPdf(e.target.files[0]); return; }
    onField(e);
  };

  el.onclick = async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'parse') return parseHeuristic();
    if (act === 'ai') return parseAi();
    if (act === 'sample') {
      S.text = kind === 'trip' ? SAMPLE_TRIP : (t.dataset.which === 'list' ? SAMPLE_AGENDA_LIST : SAMPLE_AGENDA_TABLE);
      S.pages = null; S.pagesText = ''; S.fileName = ''; S.fileBuf = null;
      draw();
      return;
    }
    if (act === 'clear-file') { Object.assign(S, { pages: null, pagesText: '', fileName: '', fileBuf: null, text: '' }); draw(); return; }
    if (act === 'back') { S.step = 'source'; draw(); return; }
    if (act === 'save') {
      t.disabled = true;
      try { await (kind === 'agenda' ? saveAgenda() : saveTrip()); t.disabled = false; } catch (err) { console.error(err); toast(err.message || 'Błąd zapisu', 'err'); t.disabled = false; }
      return;
    }
    if (kind === 'agenda' && S.step === 'review') {
      const ri = Number(t.dataset.r);
      if (act === 'rv-del-room') { S.draft.rooms.splice(ri, 1); S.openRoom = -1; draw(); return; }
      if (act === 'rv-del-sess') { S.draft.rooms[ri].sessions.splice(Number(t.dataset.s), 1); S.openRoom = ri; draw(); return; }
      if (act === 'rv-add-sess') {
        const r = S.draft.rooms[ri];
        const last = r.sessions[r.sessions.length - 1];
        r.sessions.push({ id: uid('s_'), date: last?.date || S.defaultDate, start: last?.end || '09:00', end: '', title: '', speaker: '', notes: '', cues: '' });
        S.openRoom = ri; draw(); return;
      }
      if (act === 'rv-add-room') {
        S.draft.rooms.push({ id: uid('r_'), name: `Sala ${S.draft.rooms.length + 1}`, sessions: [] });
        S.openRoom = S.draft.rooms.length - 1; draw(); return;
      }
    }
    if (kind === 'trip' && S.step === 'review') {
      await crewTab.handle(act, t, { ev: S.draft, save: async () => { const y = window.scrollY; draw(); window.scrollTo(0, y); } });
    }
  };

  draw();
}

/* ---------- templates ---------- */

function targetFields() {
  const opts = [...state.events.map(e => [e.id, `${e.name} · ${fmtDate(e.startDate, { short: true })}`]), ['__new', '+ Nowe wydarzenie']];
  return `
  <section class="card">
    <label class="field"><span class="field-label">Zapisz do</span>
      <select class="input" id="target">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === S.eventId ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    </label>
    ${S.eventId === '__new' ? field('Nazwa nowego wydarzenia', `<input class="input" id="new-name" value="${esc(S.newName)}" placeholder="np. Kongres XYZ 2026">`) : ''}
    ${field(S.kind === 'agenda' ? 'Data dnia 1 (gdy w dokumencie brak dat)' : 'Data wyjazdu (gdy w dokumencie brak dat)',
      `<input class="input" type="date" id="def-date" value="${esc(S.defaultDate)}">`)}
  </section>`;
}

function sourceHtml(kind) {
  const samples = kind === 'agenda'
    ? `<button class="chip" data-act="sample" data-which="table">Przykład: tabela 8 sal</button><button class="chip" data-act="sample" data-which="list">Przykład: lista</button>`
    : `<button class="chip" data-act="sample">Przykład karty</button>`;
  return `
  ${targetFields()}
  <section class="card">
    <h3 class="card-title">${icon('file')}Plik PDF</h3>
    <p class="small muted">${kind === 'agenda'
      ? 'Agenda jako tabela (sale w kolumnach) albo lista z nagłówkami sal. Tekst czytam razem z pozycją na stronie.'
      : 'Karta wyjazdowa: ekipa z telefonami, wyjazd, auta, hotel, pokoje, calle.'}</p>
    ${S.fileName ? `<div class="file-chip">${icon('file')}<span class="grow">${esc(S.fileName)} · ${S.numPages} str.</span><button class="icon-btn sm" data-act="clear-file" aria-label="Usuń plik">${icon('x')}</button></div>` : ''}
    <label class="btn block ${S.fileName ? '' : 'primary'} file-btn">${icon('upload')}${S.fileName ? 'Wybierz inny PDF' : 'Wybierz plik PDF'}
      <input type="file" id="pdf-input" accept="application/pdf,.pdf" hidden></label>
  </section>
  <section class="card">
    <h3 class="card-title">${icon('paste')}${S.fileName ? 'Tekst z PDF (możesz poprawić)' : 'Albo wklej tekst'}</h3>
    <textarea class="input mono" id="src-text" rows="10" placeholder="${kind === 'agenda' ? 'Wklej agendę – np. skopiowaną z maila, Worda lub Excela (kolumny = sale)…' : 'Wklej kartę wyjazdową…'}">${esc(S.text)}</textarea>
    <div class="chips wrap">${samples}</div>
  </section>
  <div class="sticky-actions">
    <button class="btn primary" data-act="parse">${icon('check')}Rozpoznaj</button>
    ${hasAiKey() ? `<button class="btn" data-act="ai">${icon('cpu')}Analizuj z AI</button>` : ''}
  </div>
  ${hasAiKey() ? '' : `<p class="small muted center pad">Opcjonalnie: dodaj własny klucz API w <a class="link" href="#/settings">Ustawieniach</a>, by analizować trudne dokumenty z AI.</p>`}`;
}

function agendaReviewHtml() {
  const d = S.draft;
  const ev = S.eventId !== '__new' ? getEvent(S.eventId) : null;
  const total = d.rooms.reduce((a, r) => a + r.sessions.length, 0);
  const dates = [...new Set([...(ev ? eventDays(ev) : []), S.defaultDate, addDays(S.defaultDate, 1), ...d.rooms.flatMap(r => r.sessions.map(s => s.date))].filter(isDate))].sort();
  const dateOpts = dates.map(x => [x, fmtDate(x, { weekday: true, short: true })]);
  const guessed = d.rooms.some(r => r.sessions.some(s => s.guessedEnd));
  return `
  <section class="card review-sum">
    <div class="stat"><strong>${d.rooms.length}</strong><span>${plural(d.rooms.length, "sala", "sale", "sal")}</span></div>
    <div class="stat"><strong>${total}</strong><span>${plural(total, "sesja", "sesje", "sesji")}</span></div>
    ${((n) => `<div class="stat"><strong>${n}</strong><span>${plural(n, "dzień", "dni", "dni")}</span></div>`)(new Set(d.rooms.flatMap(r => r.sessions.map(s => s.date))).size)}
  </section>
  <p class="small muted pad">Popraw nazwy sal, godziny i tytuły. ${guessed ? 'Godziny końca oznaczone <span class="guess">~</span> zostały odgadnięte z następnej sesji.' : ''}</p>
  ${d.rooms.map((r, ri) => `
    <details class="card rv-room" ${ri === S.openRoom ? 'open' : ''}>
      <summary><span class="grow"><strong>${esc(r.name || '(bez nazwy)')}</strong><small class="muted">${pl(r.sessions.length, "sesja", "sesje", "sesji")}</small></span>${icon('chevronDown', 'chev')}</summary>
      <div class="rv-body">
        <div class="rv-room-name">
          <input class="input" data-r="${ri}" data-f="name" value="${esc(r.name)}" aria-label="Nazwa sali">
          <button class="icon-btn danger" data-act="rv-del-room" data-r="${ri}" aria-label="Usuń salę">${icon('trash')}</button>
        </div>
        ${r.sessions.map((s, si) => `
          <div class="rv-sess">
            <div class="rv-line">
              ${select('date', dateOpts, s.date).replace('<select class="input"', `<select class="input sm" data-r="${ri}" data-s="${si}" data-f="date"`)}
              <input class="input sm" type="time" data-r="${ri}" data-s="${si}" data-f="start" value="${esc(s.start)}" aria-label="Start">
              <input class="input sm ${s.guessedEnd ? 'guessed' : ''}" type="time" data-r="${ri}" data-s="${si}" data-f="end" value="${esc(s.end)}" aria-label="Koniec">
              <button class="icon-btn sm" data-act="rv-del-sess" data-r="${ri}" data-s="${si}" aria-label="Usuń sesję">${icon('x')}</button>
            </div>
            <input class="input" data-r="${ri}" data-s="${si}" data-f="title" value="${esc(s.title)}" placeholder="Tytuł">
            <input class="input sm" data-r="${ri}" data-s="${si}" data-f="speaker" value="${esc(s.speaker)}" placeholder="Prelegent">
          </div>`).join('')}
        <button class="btn block ghost" data-act="rv-add-sess" data-r="${ri}">${icon('plus')}Dodaj sesję</button>
      </div>
    </details>`).join('')}
  <button class="btn block" data-act="rv-add-room">${icon('plus')}Dodaj salę</button>
  ${ev && ev.rooms.length ? `
  <section class="card">
    <span class="field-label">Wydarzenie ma już ${pl(ev.rooms.length, "salę", "sale", "sal")}</span>
    <label class="radio"><input type="radio" name="mode" value="merge" ${S.mode === 'merge' ? 'checked' : ''}><span>Dołącz – scal sale o tych samych nazwach</span></label>
    <label class="radio"><input type="radio" name="mode" value="replace" ${S.mode === 'replace' ? 'checked' : ''}><span>Zastąp całą agendę</span></label>
  </section>` : ''}
  <p class="small muted pad">Zapis do: <strong>${esc(ev ? ev.name : (S.newName || 'nowe wydarzenie'))}</strong>${S.fileName ? ' · PDF zostanie zapisany przy wydarzeniu' : ''}</p>
  <div class="sticky-actions">
    <button class="btn ghost" data-act="back">${icon('back')}Wróć</button>
    <button class="btn primary" data-act="save">${icon('check')}Zapisz</button>
  </div>`;
}

function tripReviewHtml() {
  const d = S.draft;
  const ev = S.eventId !== '__new' ? getEvent(S.eventId) : null;
  const t = d.trip;
  const found = [
    [d.crew.length, plural(d.crew.length, "osoba", "osoby", "osób")], [t.vehicles.length, plural(t.vehicles.length, "pojazd", "pojazdy", "pojazdów")], [t.hotelRooms.length, plural(t.hotelRooms.length, "pokój", "pokoje", "pokoi")], [t.calls.length, plural(t.calls.length, "call", "calle", "calli")]
  ];
  return `
  <section class="card review-sum">${found.map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('')}</section>
  <p class="small muted pad">Dotknij pozycji, żeby poprawić. Sale z karty, których nie ma w wydarzeniu, zostaną dodane.</p>
  ${d.crew.length || t.calls.length || t.vehicles.length ? crewTab.html(d, { mode: 'review' })
    : emptyState('alert', 'Nic nie rozpoznałem', 'Spróbuj wkleić tekst w innym układzie albo użyj AI.')}
  <p class="small muted pad">Zapis do: <strong>${esc(ev ? ev.name : (S.newName || 'nowe wydarzenie'))}</strong></p>
  <div class="sticky-actions">
    <button class="btn ghost" data-act="back">${icon('back')}Wróć</button>
    <button class="btn primary" data-act="save">${icon('check')}Zapisz</button>
  </div>`;
}
