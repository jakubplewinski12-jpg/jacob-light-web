// Equipment checklist templates + sample texts for testing the parsers.

import { uid } from './util.js';

export const CHECKLIST_TEMPLATES = {
  'Konferencja standard': {
    'Sterowanie': ['Konsoleta + zasilacz', 'Konsoleta zapasowa / laptop z offline', 'Show file na 2 pendrive’ach', 'Node / switch sieciowy', 'Interkom – beltpacki + słuchawki'],
    'Oprawa': ['Świecenie twarzy (front) – LED profile', 'Kontry na scenę', 'Wash na sali / dekoracja', 'Lampki pulpitowe na mównicę', 'Bluelight na kulisy'],
    'Zasilanie i kable': ['DMX 5-pin + zapas', 'PowerCON / przedłużki 230V', 'Rozdzielnia 32A / 63A', 'Przejściówki CEE', 'Kable sieciowe etherCON'],
    'Mocowania': ['Clampy / haki', 'Linki zabezpieczające', 'Statywy + belki T', 'Truss + łączniki (jeśli w projekcie)'],
    'Narzędzia i dokumenty': ['Latarka czołowa', 'Tester DMX', 'Gaffer czarny + taśma podłogowa', 'Opaski, rzepy', 'Plan świateł + agenda wydruk', 'Kontakt do technicznego obiektu']
  },
  'Teatr': {
    'Sterowanie': ['Konsoleta + backup show', 'Cue lista wydruk (2 egz.)', 'Interkom do inspicjenta', 'Monitor podglądu sceny'],
    'Oprawa': ['Profile z gobo / irysami', 'Fresnele / PC na plan', 'Filtry / folie wg planu', 'Blackwrap', 'Ruchome głowy (jeśli w projekcie)', 'Kontra i boki z wież'],
    'Efekty': ['Hazer + płyn', 'Dym ciężki (jeśli w scenariuszu)', 'Stroboskop – uzgodniony z reżyserem'],
    'Zasilanie i kable': ['Dimmery / rozdzielnie', 'DMX + splittery', 'Przedłużki i multikable'],
    'Na próbę': ['Focus po montażu dekoracji', 'Próba techniczna z inspicjentem', 'Lampki pulpitowe dla orkiestry / suflera', 'Latarka + rękawice']
  },
  'Koncert': {
    'Sterowanie': ['Konsoleta + backup', 'Show file + timecode (jeśli jest)', 'Node / switch', 'Interkom FOH–scena', 'Laptop do patchu'],
    'Oprawa': ['Ruchome głowy spot / beam / wash', 'Blindery', 'Stroboskopy', 'Listwy LED / pixel bary', 'Follow spoty + operatorzy'],
    'Efekty': ['Hazery + płyn', 'Wentylator do dymu', 'Efekty pirotechniczne – zgody (jeśli są)'],
    'Konstrukcja': ['Truss + łączniki + zawleczki', 'Wyciągarki + sterownik', 'Pasy, szekle, stalki', 'Atesty / zabezpieczenia'],
    'Zasilanie i kable': ['Rozdzielnia 63A / 125A', 'Multicore / kable DMX', 'PowerCON TRUE1 / przedłużki', 'Zapas bezpieczników'],
    'Inne': ['Rider oświetleniowy artysty', 'Setlista', 'Latarka, rękawice, multitool', 'Folia przeciwdeszczowa (plener)']
  }
};

export function buildChecklist(templateName) {
  const tpl = CHECKLIST_TEMPLATES[templateName];
  if (!tpl) return [];
  const out = [];
  for (const [group, items] of Object.entries(tpl)) {
    for (const text of items) out.push({ id: uid('i_'), group, text, done: false });
  }
  return out;
}

/* ---------- sample texts (for "Wstaw przykład") ---------- */

const TAB = '\t';
const row = (...cells) => cells.join(TAB);

export const SAMPLE_AGENDA_TABLE = [
  'AGENDA – Dzień 1',
  row('Godzina', 'Sala Plenarna', 'Sala A', 'Sala B', 'Sala C', 'Sala D', 'Aula 2', 'Studio Live', 'Foyer'),
  row('08:00–09:00', '', '', '', '', '', '', '', 'Rejestracja uczestników'),
  row('09:00–09:30', 'Otwarcie konferencji', '', '', '', '', '', '', ''),
  row('', 'Anna Wiśniewska', '', '', '', '', '', '', ''),
  row('09:30–10:30', 'Keynote: Przyszłość eventów', 'Chmura w praktyce', 'AI w produkcji', 'Zero Trust', 'GitOps w 45 minut', 'Pitch session #1', 'Wywiad live', ''),
  row('', 'Marek Lewandowski', 'Anna Nowak', 'Piotr Zieliński', 'Ewa Szymańska', 'Jan Dąbrowski', 'Jury konkursu', 'Kasia Wójcik', ''),
  row('10:30–11:00', 'Przerwa kawowa'),
  row('11:00–12:00', 'Panel CIO', 'Kubernetes w produkcji', 'Data mesh', 'Ransomware', 'Platform engineering', 'Fundraising 2026', 'Wywiad live', 'Strefa wystawców'),
  row('12:00–13:00', 'Cyberbezpieczeństwo', 'FinOps', 'MLOps', 'NIS2 w praktyce', 'SRE', 'Product-market fit', '', ''),
  row('13:00–14:00', 'Lunch'),
  row('14:00–15:00', 'Keynote: AI w przemyśle', 'Serverless', 'Agenci AI', 'Red team', 'Chaos engineering', 'Pitch session #2', 'Wywiad live', ''),
  row('15:00–16:00', 'Debata: regulacje', 'Multi-cloud', 'AI Act', 'Bezpieczeństwo OT', 'Feature flags', 'Skalowanie CEE', '', ''),
  row('16:30–17:30', 'Gala nagród', '', '', '', '', '', '', 'Networking')
].join('\n');

export const SAMPLE_AGENDA_LIST = `Dzień 1

Sala A
09:00 - 10:00 Otwarcie i powitanie
Prowadzący: Jan Kowalski
10:00 - 11:30 Warsztat: projektowanie światła na scenie
dr Anna Nowak
11:30 - 12:00 Przerwa kawowa
12:00 - 13:00 Panel dyskusyjny – Piotr Wiśniewski

Sala B
09.30-10.30 Technologie LED w teatrze
10.45-12.15 Sterowanie DMX i sACN w praktyce – Marta Zielińska

Scena Główna
19:00 Koncert otwarcia
21:00 Afterparty

Dzień 2

Sala A
09:00–12:00 Warsztaty dla realizatorów
Sala B
10:00 – 11:00 Bezpieczeństwo pracy na wysokości`;

export const SAMPLE_TRIP = `KARTA WYJAZDOWA – Gala firmowa

EKIPA
1. Jacob – realizator oświetlenia (LD) – Scena Główna – 600 100 200
2. Marta Zielińska – oświetleniowiec – Sala A – 600 100 201
3. Tomek Wrona – technik – Sala B – 600 100 202
4. Michał Duda – kierowca / technik – 600 100 203
5. Ola Sadowska – technik oświetlenia – Sala A – 600 100 204

TRANSPORT
Zbiórka: 06:00 – magazyn, ul. Fabryczna 12, Poznań
Bus 1 (Sprinter, PO 1LT23) – kierowca: Michał Duda; jadą: Jacob, Marta Zielińska
Auto 2 (Skoda, PO 3EV55) – kierowca: Tomek Wrona; jadą: Ola Sadowska
Przyjazd na miejsce: 09:30

HOTEL
Hotel Saski, ul. Krakowskie Przedmieście 1, Warszawa
Zameldowanie 22:00
Pokój 101: Jacob, Michał Duda
Pokój 102: Marta Zielińska, Ola Sadowska
Pokój 103: Tomek Wrona

HARMONOGRAM
10:00 Rozładunek – wszyscy
13:00 Programowanie świateł – Jacob, Marta
17:30 Próba generalna
19:00 Start gali
23:30 Demontaż – wszyscy
Powrót: 02:00 spod hotelu

UWAGI
Czarne ubranie, identyfikatory odbieramy na recepcji.`;
