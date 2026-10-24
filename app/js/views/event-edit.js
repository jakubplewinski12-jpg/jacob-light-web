// Create / edit event form.

import { todayStr, deepClone, isDate, parseAmount, grossOf, netOf } from '../util.js';
import { icon } from '../icons.js';
import { getEvent, newEvent, saveEvent, normalizeEvent, EVENT_TYPES, VAT_RATES } from '../store.js';
import { setHeader, field, input, textarea, select, row2, formData, toast, emptyState } from '../ui.js';

const TYPE_LABELS = {
  'konferencja': 'Konferencja', 'gala': 'Gala', 'teatr': 'Teatr', 'koncert': 'Koncert',
  'sport': 'Sport', 'targi': 'Targi', 'event firmowy': 'Event firmowy', 'inne': 'Inne'
};

// 1234.5 -> "1234,50" for the inputs (Polish decimal comma, no thousands separator)
const amountStr = n => (n == null ? '' : n.toFixed(2).replace('.', ','));

export function render({ el, params, query }) {
  const existing = params.id ? getEvent(params.id) : null;
  if (params.id && !existing) {
    setHeader({ title: 'Edycja', back: '#/events' });
    el.innerHTML = emptyState('alert', 'Nie znaleziono wydarzenia');
    return;
  }
  const day = isDate(query.date) ? query.date : todayStr();
  const ev = existing ? deepClone(existing) : newEvent({ name: '', startDate: day, endDate: day });
  setHeader({
    title: existing ? 'Edytuj wydarzenie' : 'Nowe wydarzenie',
    back: existing ? `#/event/${ev.id}` : '#/events'
  });

  el.innerHTML = `
  <form class="form" id="ev-form" novalidate>
    ${field('Nazwa wydarzenia', input('name', existing ? ev.name : '', { placeholder: 'np. Gala Firmy X 2026', attrs: 'required autocomplete="off"' }))}
    ${row2(
      field('Typ', select('type', EVENT_TYPES.map(t => [t, TYPE_LABELS[t] || t]), ev.type)),
      field('Klient', input('client', ev.client, { placeholder: 'Firma / agencja' }))
    )}
    ${field('Obiekt', input('venue', ev.venue, { placeholder: 'np. Centrum Kongresowe' }))}
    ${field('Adres', input('address', ev.address, { placeholder: 'ul., miasto' }))}
    ${row2(
      field('Od', input('startDate', ev.startDate, { type: 'date' })),
      field('Do', input('endDate', ev.endDate, { type: 'date' }))
    )}
    <h3 class="form-sub">Harmonogram</h3>
    ${field('Wyjazd – dzień i godzina', input('depDt', ev.trip.departure.dt, { type: 'datetime-local' }))}
    ${field('Miejsce zbiórki', input('depPlace', ev.trip.departure.place, { placeholder: 'np. magazyn, ul. Fabryczna 12' }))}
    ${field('Montaż – dzień i godzina', input('loadIn', ev.loadIn, { type: 'datetime-local' }))}
    ${field('Start show', input('showStart', ev.showStart, { type: 'datetime-local' }))}
    ${field('Koniec show', input('showEnd', ev.showEnd, { type: 'datetime-local' }))}
    ${field('Demontaż – dzień i godzina', input('loadOut', ev.loadOut, { type: 'datetime-local' }))}
    ${field('Powrót – dzień i godzina', input('retDt', ev.trip.ret.dt, { type: 'datetime-local' }))}
    <h3 class="form-sub">Stawka</h3>
    ${row2(
      field('Netto (zł)', input('feeNet', amountStr(ev.fee.net), { attrs: 'inputmode="decimal" autocomplete="off"', placeholder: '0' })),
      field('Brutto (zł)', input('feeGross', ev.fee.net == null ? '' : amountStr(grossOf(ev.fee.net, ev.fee.vat)), { attrs: 'inputmode="decimal" autocomplete="off"', placeholder: '0' }))
    )}
    ${field('VAT', select('feeVat', VAT_RATES.map(v => [v, v ? `${v}%` : 'zw. / bez VAT']), ev.fee.vat), 'Wpisz netto albo brutto – druga kwota przeliczy się sama.')}
    <label class="field switch-row inline-switch"><span class="grow field-label">Opłacone</span><input type="checkbox" class="switch" name="feePaid" ${ev.fee.paid ? 'checked' : ''}></label>
    ${field('Notatki', textarea('notes', ev.notes, { rows: 4, placeholder: 'Zasilanie, rozładunek, dress code…' }))}
    <button class="btn primary block" type="submit">${icon('check')}Zapisz</button>
  </form>`;

  // keep net and gross in sync; whichever was typed last is the source
  const f = el.querySelector('#ev-form');
  const netEl = f.elements.feeNet, grossEl = f.elements.feeGross, vatEl = f.elements.feeVat;
  let lastTyped = 'net';
  const sync = () => {
    const vat = Number(vatEl.value);
    if (lastTyped === 'net') {
      const n = parseAmount(netEl.value);
      grossEl.value = n == null ? '' : amountStr(grossOf(n, vat));
    } else {
      const g = parseAmount(grossEl.value);
      netEl.value = g == null ? '' : amountStr(netOf(g, vat));
    }
  };
  netEl.oninput = () => { lastTyped = 'net'; sync(); };
  grossEl.oninput = () => { lastTyped = 'gross'; sync(); };
  vatEl.onchange = sync;

  el.onsubmit = async e => {
    e.preventDefault();
    const d = formData(el.querySelector('#ev-form'));
    if (!d.name) { toast('Podaj nazwę wydarzenia', 'err'); el.querySelector('[name="name"]').focus(); return; }
    const { feeNet, feeGross, feeVat, feePaid, depDt, depPlace, retDt, ...rest } = d;
    Object.assign(ev, rest);
    // departure / return live in the trip sheet; the same values show in Ekipa → karta wyjazdowa
    ev.trip.departure.dt = depDt; ev.trip.departure.place = depPlace; ev.trip.ret.dt = retDt;
    ev.fee = { net: parseAmount(feeNet), vat: Number(feeVat), paid: feePaid };
    if (feeNet && ev.fee.net == null) { toast('Nieprawidłowa kwota netto', 'err'); netEl.focus(); return; }
    if (!isDate(ev.endDate) || ev.endDate < ev.startDate) ev.endDate = ev.startDate;
    const saved = normalizeEvent(ev);
    await saveEvent(saved);
    toast('Zapisano');
    location.hash = `#/event/${saved.id}`;
  };
}
