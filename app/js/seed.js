// Demo event created on first run (relative to today, so "Teraz" has live data).

import { newEvent, saveEvent } from './store.js';
import { todayStr, addDays, uid } from './util.js';
import { buildChecklist } from './templates.js';

const SPEAKERS = ['Anna Nowak', 'Piotr Wiśniewski', 'Katarzyna Wójcik', 'Tomasz Kowalczyk', 'Magdalena Kamińska',
  'Krzysztof Lewandowski', 'Agnieszka Zielińska', 'Paweł Szymański', 'Joanna Woźniak', 'Marcin Dąbrowski',
  'Monika Kozłowska', 'Łukasz Jankowski', 'Aleksandra Mazur', 'Grzegorz Kwiatkowski', 'Natalia Wróbel', 'Rafał Piotrowski'];

const TRACKS = {
  'Sala A – Cloud': ['Migracja do chmury bez przestojów', 'Kubernetes w produkcji: lekcje z 3 lat', 'FinOps: jak przestać przepalać budżet', 'Architektura multi-cloud', 'Serverless w praktyce', 'Kontenery a bezpieczeństwo', 'Observability od zera', 'Infrastruktura jako kod', 'Edge computing w retailu', 'Chmura suwerenna w Polsce', 'Disaster recovery – case study', 'Q&A z architektami'],
  'Sala B – AI & Data': ['Modele językowe w obsłudze klienta', 'Data mesh: teoria vs praktyka', 'MLOps w średniej firmie', 'Wizja komputerowa na linii produkcyjnej', 'Etyka danych', 'Jak mierzyć ROI z AI', 'Agenci AI w back-office', 'Hurtownia danych w czasie rzeczywistym', 'Prognozowanie popytu', 'AI Act – co musisz wiedzieć', 'Generatywne AI w marketingu', 'Warsztat: prompt engineering'],
  'Sala C – Security': ['Zero Trust krok po kroku', 'Ransomware: anatomia ataku', 'SOC na 5 osób', 'Bezpieczeństwo łańcucha dostaw', 'Phishing 2026', 'NIS2 w praktyce', 'Red team vs blue team', 'Tożsamość i dostęp', 'Bezpieczeństwo OT', 'Kryptografia postkwantowa', 'Incident response – symulacja', 'Bug bounty w Polsce'],
  'Sala D – DevOps': ['Platform engineering', 'CI/CD dla monorepo', 'GitOps w 45 minut', 'Testy kontraktowe', 'SRE: budżety błędów', 'Feature flags bez bólu', 'Developer experience', 'Release train w bankowości', 'Chaos engineering', 'Wydajność aplikacji webowych', 'Mikroserwisy: kiedy nie', 'Warsztat: pipeline od zera'],
  'Aula 2 – Startupy': ['Pitch session #1', 'Fundraising w 2026', 'Jak budować zespół produktowy', 'Product-market fit', 'Rozmowa z inwestorami', 'Pitch session #2', 'Pitch session #3', 'Skalowanie na rynki CEE', 'Growth bez budżetu', 'Prawo dla startupów', 'Finał konkursu startupów', 'Ogłoszenie zwycięzców']
};

const SLOTS = [['09:30', '10:30'], ['11:00', '12:00'], ['12:00', '13:00'], ['14:00', '15:00'], ['15:00', '16:00'], ['16:30', '17:30']];
const BREAKS = [['10:30', '11:00', 'Przerwa kawowa'], ['13:00', '14:00', 'Lunch'], ['16:00', '16:30', 'Przerwa kawowa']];

const S = (date, start, end, title, speaker = '', notes = '', cues = '') =>
  ({ id: uid('s_'), date, start, end, title, speaker, notes, cues });

function plenary(d1, d2) {
  return [
    S(d1, '08:30', '09:00', 'Walk-in', '', 'Muzyka z offline, logo na ekranach', 'Walk-in: ciepłe 3200K na sali 40%, gobo logo na kotarze, kontry wolny fade'),
    S(d1, '09:00', '09:30', 'Otwarcie TechForum 2026', 'Anna Wiśniewska, Michał Kozłowski', 'Prowadzący wchodzą z lewej kulisy', 'GO 1: blackout sali, GO 2: front 70% na mównicę + kontry białe'),
    S(d1, '09:30', '10:30', 'Keynote: Infrastruktura jutra', 'Marek Lewandowski', 'Mikroport HS, chodzi po całej scenie', 'Front na całą szerokość, sala 15%, kontry chłodne'),
    S(d1, '10:30', '11:00', 'Przerwa kawowa', '', '', 'Sala 60%, scena preset przerwa'),
    S(d1, '11:00', '12:00', 'Panel CIO: Chmura bez hype’u', 'moderacja: Katarzyna Wójcik', '4 fotele + moderator, stoliki', 'Preset PANEL: 5 punktów twarzy, tło niebieskie'),
    S(d1, '12:00', '13:00', 'Cyberbezpieczeństwo w praktyce', 'Piotr Kamiński'),
    S(d1, '13:00', '14:00', 'Lunch', '', '', 'Sala 60%'),
    S(d1, '14:00', '15:00', 'Keynote: AI w przemyśle', 'dr Tomasz Zieliński', '', 'Jak keynote rano'),
    S(d1, '15:00', '16:00', 'Debata: regulacje i dane', 'Ewa Szymańska, Jan Dąbrowski'),
    S(d1, '16:00', '16:30', 'Przerwa kawowa'),
    S(d1, '16:30', '17:30', 'Gala nagród TechForum', 'prowadzenie: Michał Kozłowski', '12 statuetek, wejścia z sali', 'Ruchome na wejścia nagrodzonych, strobo OFF, finał: confetti + full'),
    S(d2, '09:00', '09:15', 'Powitanie dnia 2', 'Anna Wiśniewska'),
    S(d2, '09:15', '10:30', 'Keynote: Bezpieczna transformacja', 'Agnieszka Zielińska'),
    S(d2, '10:30', '11:00', 'Przerwa kawowa'),
    S(d2, '11:00', '12:30', 'Panel: Talenty w IT', 'moderacja: Paweł Szymański', '5 panelistów'),
    S(d2, '12:30', '13:00', 'Prezentacja partnera strategicznego', 'Joanna Woźniak'),
    S(d2, '13:00', '14:00', 'Lunch'),
    S(d2, '14:00', '15:30', 'Fireside chat: CEO', 'Marcin Dąbrowski, Monika Kozłowska', '2 fotele, ciepło', 'Preset FIRESIDE'),
    S(d2, '15:30', '16:00', 'Przerwa kawowa'),
    S(d2, '16:00', '17:00', 'Podsumowanie i zamknięcie', 'Anna Wiśniewska', '', 'Finał: full + logo, wyjście publiczności: sala 80%')
  ];
}

function track(titles, d1, d2, offset) {
  const out = [];
  [d1, d2].forEach((date, di) => {
    SLOTS.forEach(([a, b], i) => {
      const k = di * 6 + i;
      out.push(S(date, a, b, titles[k], SPEAKERS[(k + offset * 3) % SPEAKERS.length]));
    });
    BREAKS.forEach(([a, b, t]) => out.push(S(date, a, b, t)));
  });
  return out;
}

function studio(d1, d2) {
  const times = [['10:00', '10:30'], ['10:45', '11:15'], ['11:30', '12:00'], ['12:15', '12:45'], ['14:00', '14:30'], ['14:45', '15:15'], ['15:30', '16:00'], ['16:15', '16:45']];
  const out = [];
  [d1, d2].forEach((date, di) => times.forEach(([a, b], i) => {
    const sp = SPEAKERS[(i * 3 + di * 5) % SPEAKERS.length];
    out.push(S(date, a, b, `Wywiad live: ${sp}`, sp, 'Stream na YouTube', 'Key 45° + fill, tło RGB w kolorach klienta'));
  }));
  return out;
}

function foyer(d1, d2) {
  return [
    S(d1, '08:00', '09:00', 'Rejestracja uczestników', '', 'Lada recepcji – świecenie robocze'),
    S(d1, '10:30', '11:00', 'Przerwa kawowa'),
    S(d1, '13:00', '14:00', 'Lunch networkingowy'),
    S(d1, '16:00', '16:30', 'Przerwa kawowa'),
    S(d1, '18:00', '21:00', 'Networking party – DJ', 'DJ Nocny Tramwaj', 'Ruchome + LED bary na kolumnach', 'Party: kolory klienta, chase wolny, haze lekki'),
    S(d2, '08:30', '09:00', 'Rejestracja dzień 2'),
    S(d2, '10:30', '11:00', 'Przerwa kawowa'),
    S(d2, '13:00', '14:00', 'Lunch'),
    S(d2, '15:30', '16:00', 'Przerwa kawowa')
  ];
}

export async function seedDemo() {
  const t = todayStr();
  const d0 = addDays(t, -1), d1 = t, d2 = addDays(t, 1), d3 = addDays(t, 2);

  const rooms = [
    { id: uid('r_'), name: 'Sala Plenarna', sessions: plenary(d1, d2), contacts: [
      { id: uid('k_'), name: 'Ewa Mazur', role: 'Inspicjent sceny', phone: '603 210 410' },
      { id: uid('k_'), name: 'Tomasz Bielecki', role: 'Technik obiektu – sala', phone: '604 330 220' }
    ] },
    ...Object.entries(TRACKS).map(([name, titles], i) => ({ id: uid('r_'), name, sessions: track(titles, d1, d2, i) })),
    { id: uid('r_'), name: 'Studio Live', sessions: studio(d1, d2), contacts: [
      { id: uid('k_'), name: 'Karolina Sowa', role: 'Realizator wizji', phone: '605 440 550' }
    ] },
    { id: uid('r_'), name: 'Foyer', sessions: foyer(d1, d2) }
  ];
  const R = name => rooms.find(r => r.name.startsWith(name)).id;

  const P = (name, role, phone, roomId = '') => ({ id: uid('p_'), name, role, phone, roomId, notes: '' });
  const crew = [
    P('Jacob', 'Realizator oświetlenia / LD', '600 100 200', R('Sala Plenarna')),
    P('Marta Zielińska', 'Oświetleniowiec', '600 100 201', R('Aula 2')),
    P('Tomek Wrona', 'Technik oświetlenia', '600 100 202', R('Sala A')),
    P('Ola Sadowska', 'Technik oświetlenia', '600 100 203', R('Sala B')),
    P('Paweł Mazurek', 'Rigger / technik', '600 100 204', R('Sala C')),
    P('Bartek Sowa', 'Technik oświetlenia', '600 100 205', R('Sala D')),
    P('Kuba Nowicki', 'Operator wideo', '600 100 206', R('Studio Live')),
    P('Michał Duda', 'Kierowca / technik', '600 100 207', R('Foyer')),
    P('Ewa Lis', 'Kierownik produkcji', '600 100 208')
  ];
  const id = name => crew.find(p => p.name.startsWith(name)).id;

  const checklist = buildChecklist('Konferencja standard');
  checklist.slice(0, 7).forEach(i => { i.done = true; });

  const ev = newEvent({
    name: 'Konferencja TechForum 2026',
    client: 'TechForum Sp. z o.o.',
    venue: 'Centrum Konferencyjne EXPO',
    address: 'ul. Konferencyjna 1, Warszawa',
    type: 'konferencja',
    startDate: d0,
    endDate: d2,
    loadIn: `${d0}T14:00`,
    showStart: `${d1}T09:00`,
    showEnd: `${d2}T17:00`,
    loadOut: `${d2}T17:30`,
    notes: 'Zasilanie: 3× 63A CEE w kulisie Sali Plenarnej. Rozładunek od ul. Magazynowej, rampa nr 2 (wjazd do 3,5 t). Dress code: czarne ubranie. To jest wydarzenie demonstracyjne – możesz je usunąć.',
    fee: { net: 4800, vat: 23, paid: false },
    contacts: [
      { id: uid('k_'), name: 'Anna Wiśniewska', role: 'Producent po stronie klienta', phone: '601 300 400', email: '' },
      { id: uid('k_'), name: 'Robert Kaczmarek', role: 'Kierownik techniczny obiektu', phone: '602 500 600', email: '' }
    ],
    rooms,
    crew,
    trip: {
      departure: { dt: `${d0}T10:00`, place: 'Magazyn, ul. Fabryczna 12, Poznań' },
      arrival: { dt: `${d0}T13:30` },
      ret: { dt: `${d2}T21:30`, place: 'Spod obiektu', arrivalDt: `${d3}T01:00` },
      vehicles: [
        { id: uid('v_'), name: 'Bus 1 – Sprinter', plate: 'PO 1LT23', driverId: id('Michał'), passengerIds: [id('Jacob'), id('Marta'), id('Tomek')] },
        { id: uid('v_'), name: 'Bus 2 – Master', plate: 'PO 7KX41', driverId: id('Bartek'), passengerIds: [id('Ola'), id('Paweł'), id('Kuba')] },
        { id: uid('v_'), name: 'Osobówka – Skoda', plate: 'PO 3EV55', driverId: id('Ewa'), passengerIds: [] }
      ],
      hotel: { name: 'Hotel Saski', address: 'ul. Konferencyjna 5, Warszawa', phone: '22 100 20 30', checkIn: `${d0}T22:30`, checkOut: `${d2}T07:00` },
      hotelRooms: [
        { id: uid('h_'), number: '101', personIds: [id('Jacob'), id('Tomek')] },
        { id: uid('h_'), number: '102', personIds: [id('Marta'), id('Ola')] },
        { id: uid('h_'), number: '103', personIds: [id('Paweł'), id('Kuba')] },
        { id: uid('h_'), number: '104', personIds: [id('Bartek'), id('Michał')] },
        { id: uid('h_'), number: '105', personIds: [id('Ewa')] }
      ],
      calls: [
        { id: uid('c_'), dt: `${d0}T14:00`, label: 'Rozładunek i montaż', personIds: [] },
        { id: uid('c_'), dt: `${d0}T19:00`, label: 'Programowanie / focus – plenarna', personIds: [id('Jacob'), id('Marta'), id('Tomek')] },
        { id: uid('c_'), dt: `${d1}T07:00`, label: 'Call ekipy – dzień 1', personIds: [] },
        { id: uid('c_'), dt: `${d1}T08:00`, label: 'Próba świateł – Sala Plenarna', personIds: [id('Jacob'), id('Ewa')] },
        { id: uid('c_'), dt: `${d1}T08:45`, label: 'Gotowość techniczna wszystkich sal', personIds: [] },
        { id: uid('c_'), dt: `${d2}T07:30`, label: 'Call ekipy – dzień 2', personIds: [] },
        { id: uid('c_'), dt: `${d2}T17:30`, label: 'Demontaż', personIds: [] }
      ],
      notes: 'Identyfikatory do odbioru na recepcji obiektu. Parking dla busów: strefa C.'
    },
    checklist,
    demo: true
  });
  await saveEvent(ev);
  return ev;
}
