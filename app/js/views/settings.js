// Settings: who am I, night mode, AI key, backup, demo data, install help.

import { esc, readFileAsText, pl } from '../util.js';
import { icon, LOGO } from '../icons.js';
import { getSettings, setSetting, importBackup, wipeAll, state } from '../store.js';
import { setHeader, toast, confirmDialog, applyTheme } from '../ui.js';
import { downloadBackup } from '../export.js';
import { seedDemo } from '../seed.js';
import { AI_MODEL } from '../ai.js';

// filled in by deploy.ps1 (date + fingerprint of the app files)
export const APP_VERSION = '2026.10.25-551edea2';

export function render({ el, refresh }) {
  setHeader({ title: 'Ustawienia' });
  const s = getSettings();

  el.innerHTML = `
  <h2 class="section-title">Profil</h2>
  <section class="card">
    <label class="field"><span class="field-label">Kim jestem w ekipie</span>
      <input class="input" id="me" value="${esc(s.me)}" placeholder="np. Jacob" autocomplete="off"></label>
    <p class="small muted">Po tym imieniu aplikacja znajduje Cię w ekipie każdego wydarzenia (widok „Mój plan” i odliczanie na starcie).</p>
  </section>

  <h2 class="section-title">Wygląd</h2>
  <section class="card list">
    <label class="list-row switch-row">
      ${icon('moon')}<span class="grow"><strong>Tryb nocny (czerwony)</strong><small class="muted">Przyciemniony, czerwony interfejs do ciemnej reżyserki i kulis</small></span>
      <input type="checkbox" class="switch" id="night" ${s.night ? 'checked' : ''}>
    </label>
  </section>

  <h2 class="section-title">Analiza z AI (opcjonalnie)</h2>
  <section class="card">
    <label class="field"><span class="field-label">Klucz API Anthropic</span>
      <div class="input-group">
        <input class="input" id="api-key" type="password" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="icon-btn" data-act="toggle-key" aria-label="Pokaż / ukryj klucz">${icon('eye')}</button>
      </div>
    </label>
    <div class="btn-grid">
      <button class="btn primary" data-act="save-key">${icon('key')}Zapisz klucz</button>
      <button class="btn" data-act="clear-key" ${s.apiKey ? '' : 'disabled'}>${icon('trash')}Usuń klucz</button>
    </div>
    <p class="small muted">Klucz jest zapisywany <strong>tylko na tym urządzeniu</strong> (localStorage przeglądarki) – nie trafia do kopii zapasowej ani na żaden serwer poza api.anthropic.com. Wysyłany jest wyłącznie wtedy, gdy klikniesz „Analizuj z AI” przy imporcie; wtedy tekst dokumentu idzie do modelu ${esc(AI_MODEL)}. Koszt zapytań pokrywasz z własnego konta Anthropic. Bez klucza aplikacja działa w pełni – rozpoznawanie heurystyczne działa offline.</p>
  </section>

  <h2 class="section-title">Dane</h2>
  <section class="card list">
    <button class="list-row plain" data-act="backup">${icon('download')}<span class="grow"><strong>Eksportuj kopię zapasową</strong><small class="muted">Plik JSON: wszystkie wydarzenia + zapisane PDF-y · ${s.lastBackup ? 'ostatnio ' + new Date(s.lastBackup).toLocaleDateString('pl-PL') : 'jeszcze nie zrobiona – dane są tylko na tym telefonie'}</small></span></button>
    <button class="list-row plain" data-act="backup-light">${icon('download')}<span class="grow"><strong>Eksportuj bez PDF-ów</strong><small class="muted">Mniejszy plik</small></span></button>
    <label class="list-row">${icon('upload')}<span class="grow"><strong>Importuj kopię zapasową</strong><small class="muted">Scala z obecnymi danymi</small></span>
      <input type="file" id="restore" accept="application/json,.json" hidden></label>
    <button class="list-row plain" data-act="demo">${icon('refresh')}<span class="grow"><strong>Dodaj wydarzenie demo</strong><small class="muted">TechForum 2026 – 8 sal, ekipa, karta wyjazdowa</small></span></button>
    <button class="list-row plain" data-act="persist">${icon('database')}<span class="grow"><strong>Chroń dane przed usunięciem</strong><small class="muted" id="storage-info">Sprawdzam pamięć…</small></span></button>
    <button class="list-row plain danger" data-act="wipe">${icon('trash')}<span class="grow"><strong>Usuń wszystkie dane</strong><small class="muted">Wydarzenia i pliki z tego urządzenia</small></span></button>
  </section>

  <h2 class="section-title">Instalacja na iPhonie</h2>
  <section class="card">
    <ol class="steps">
      <li>Otwórz tę stronę w <strong>Safari</strong> (adres https).</li>
      <li>Dotknij <strong>Udostępnij</strong> ${icon('share', 'inline')} na dolnym pasku.</li>
      <li>Wybierz <strong>Do ekranu początkowego</strong> i potwierdź „Dodaj”.</li>
      <li>Uruchamiaj z ikony – działa offline i na pełnym ekranie.</li>
    </ol>
  </section>

  <section class="about">
    <span class="about-logo">${LOGO}</span>
    <p><strong>Jacob Light – Event Calendar</strong><br><span class="small muted">wersja ${APP_VERSION} · ${state.events.length} wydarzeń w pamięci</span></p>
    <p class="small muted">Aktualizacje instalują się same, gdy otworzysz aplikację.</p>
    <button class="btn" id="check-update">${icon('refresh')}Sprawdź aktualizację teraz</button>
  </section>`;

  el.querySelector('#check-update').onclick = async () => {
    if (!window.checkForUpdate) { toast('Aktualizacje działają tylko w zainstalowanej wersji (https)'); return; }
    toast('Sprawdzam…');
    await window.checkForUpdate();
    // a new version reloads the app by itself; if nothing happened we are up to date
    setTimeout(() => toast('Masz najnowszą wersję'), 3000);
  };

  const keyInput = el.querySelector('#api-key');
  storageInfo(el);

  el.oninput = e => {
    if (e.target.id === 'me') setSetting('me', e.target.value.trim());
  };
  el.onchange = async e => {
    if (e.target.id === 'night') { setSetting('night', e.target.checked); applyTheme(); return; }
    if (e.target.id === 'restore') {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const n = await importBackup(JSON.parse(await readFileAsText(f)));
        toast(`Zaimportowano ${pl(n, "wydarzenie", "wydarzenia", "wydarzeń")}`);
        refresh();
      } catch (err) {
        toast(err.message || 'Nie udało się wczytać kopii', 'err');
      }
    }
  };
  el.onclick = async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    switch (t.dataset.act) {
      case 'toggle-key': keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; break;
      case 'save-key': {
        const v = keyInput.value.trim();
        if (v && !v.startsWith('sk-')) { toast('To nie wygląda na klucz Anthropic (sk-ant-…)', 'err'); return; }
        setSetting('apiKey', v);
        toast(v ? 'Klucz zapisany na tym urządzeniu' : 'Klucz usunięty');
        refresh();
        break;
      }
      case 'clear-key':
        setSetting('apiKey', '');
        toast('Klucz usunięty');
        refresh();
        break;
      case 'backup':
      case 'backup-light': {
        const r = await downloadBackup(t.dataset.act === 'backup');
        if (r !== 'cancel') setSetting('lastBackup', Date.now());
        if (r === 'downloaded') toast('Kopia zapisana w Pobranych');
        break;
      }
      case 'demo':
        await seedDemo();
        toast('Dodano wydarzenie demo');
        refresh();
        break;
      case 'persist':
        if (navigator.storage?.persist) {
          const ok = await navigator.storage.persist();
          toast(ok ? 'Dane oznaczone jako trwałe' : 'Przeglądarka nie zgodziła się – zainstaluj aplikację na ekranie początkowym');
          storageInfo(el);
        } else toast('Ta przeglądarka nie obsługuje tej funkcji');
        break;
      case 'wipe':
        if (await confirmDialog('Usunąć wszystkie wydarzenia i pliki z tego urządzenia? Najpierw zrób kopię zapasową.', { ok: 'Usuń wszystko' })) {
          await wipeAll();
          toast('Dane usunięte');
          refresh();
        }
        break;
      default:
    }
  };
}

async function storageInfo(el) {
  const node = el.querySelector('#storage-info');
  if (!node) return;
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const used = est?.usage ? `${(est.usage / 1048576).toFixed(1)} MB zajęte` : '';
    node.textContent = [persisted ? 'Dane trwałe' : 'Dane mogą zostać wyczyszczone przez system', used].filter(Boolean).join(' · ');
  } catch {
    node.textContent = '';
  }
}
