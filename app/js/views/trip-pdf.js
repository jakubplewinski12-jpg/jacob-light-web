// Bottom sheet: choose what goes into the "Karta wyjazdowa" PDF, generate it,
// then share (iPhone share sheet), download or preview it.

import { esc, downloadBlob, plural } from '../util.js';
import { icon } from '../icons.js';
import { openSheet, toast } from '../ui.js';
import { SECTION_KEYS, buildTripSheet, defaultOptions } from '../tripsheet.js';

const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
const chip = (name, value, label, on) =>
  `<label class="pick-item"><input type="checkbox" name="${esc(name)}" value="${esc(value)}" data-multi ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`;
const switchRow = (name, label, hint, on) => `
  <label class="field switch-row inline-switch"><span class="grow"><span class="field-label">${esc(label)}</span>${hint ? `<span class="field-hint" style="display:block">${esc(hint)}</span>` : ''}</span>
  <input type="checkbox" class="switch" name="${esc(name)}" ${on ? 'checked' : ''}></label>`;

export function openTripSheetDialog(ev) {
  const def = defaultOptions(ev);
  const plots = ev.rooms.filter(r => r.plot).length;
  let result = null; // { url, file, name }
  const optionsHtml = `
    <div class="ts-group">
      <span class="field-label">Sekcje</span>
      <div class="pick">${SECTION_KEYS.map(([k, l]) => chip('sections', k, l, def.sections[k])).join('')}</div>
    </div>
    ${ev.rooms.length ? `<div class="ts-group">
      <div class="row-between"><span class="field-label">Sale (${ev.rooms.length})</span><button type="button" class="link" data-ts="rooms-toggle">Zaznacz / odznacz</button></div>
      <div class="pick">${ev.rooms.map(r => chip('rooms', r.id, r.name, true)).join('')}</div>
    </div>` : ''}
    <div class="ts-group">
      ${switchRow('plots', 'Dołącz ploty sal', plots ? `${plots} ${plural(plots, 'sala ma', 'sale mają', 'sal ma')} dodany plot` : 'Żadna sala nie ma jeszcze planu', plots > 0)}
      ${ev.fee.net != null ? switchRow('fee', 'Pokaż stawkę (netto / brutto)', 'Karta trafia do ekipy – domyślnie bez stawki', false) : ''}
    </div>
    <div class="ts-out" aria-live="polite"></div>`;

  const api = openSheet({
    title: 'Karta wyjazdowa (PDF)',
    body: optionsHtml,
    actions: [{
      label: 'Generuj PDF', kind: 'primary', onClick: async a => {
        const d = a.data();
        const opt = {
          sections: Object.fromEntries(SECTION_KEYS.map(([k]) => [k, (d.sections || []).includes(k)])),
          roomIds: d.rooms || [],
          plots: !!d.plots,
          fee: !!d.fee
        };
        const out = a.body.querySelector('.ts-out');
        out.innerHTML = '<div class="ts-progress"><span class="spinner"></span><span data-ts="msg">Przygotowuję…</span></div>';
        out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        try {
          const res = await buildTripSheet(ev, opt, msg => { const m = out.querySelector('[data-ts="msg"]'); if (m) m.textContent = msg; });
          if (result) URL.revokeObjectURL(result.url);
          const blob = new Blob([res.bytes], { type: 'application/pdf' });
          const file = new File([blob], res.name, { type: 'application/pdf' });
          result = { url: URL.createObjectURL(blob), file, blob, name: res.name };
          const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
          out.innerHTML = `
            <div class="card ts-result">
              <div class="ts-file">${icon('file')}<span class="grow"><strong>${esc(res.name)}</strong>
                <small class="muted">${res.pages} ${plural(res.pages, 'strona', 'strony', 'stron')} · ${kb(blob.size)}</small></span></div>
              <div class="btn-grid">
                <button type="button" class="btn primary" data-ts="share">${icon(canShare ? 'share' : 'download')}${canShare ? 'Udostępnij' : 'Pobierz'}</button>
                <a class="btn" href="${result.url}" target="_blank" rel="noopener" data-ts="preview">${icon('eye')}Podgląd</a>
              </div>
              ${canShare ? '<button type="button" class="link" data-ts="download">' + icon('download') + 'Zapisz jako plik</button>' : ''}
            </div>`;
          const btn = a.el.querySelector('[data-sact="0"]');
          if (btn) btn.textContent = 'Generuj ponownie';
        } catch (e) {
          console.error(e);
          out.innerHTML = `<p class="small" style="color:var(--danger)">${esc(e.message || 'Nie udało się wygenerować PDF.')}</p>`;
        }
        return false; // keep the sheet open: share needs a fresh tap
      }
    }],
    onClose: () => { if (result) { const u = result.url; setTimeout(() => URL.revokeObjectURL(u), 60000); } }
  });

  api.body.addEventListener('click', async e => {
    const t = e.target.closest('[data-ts]');
    if (!t) return;
    const act = t.dataset.ts;
    if (act === 'rooms-toggle') {
      const boxes = [...api.body.querySelectorAll('input[name="rooms"]')];
      const all = boxes.every(b => b.checked);
      boxes.forEach(b => { b.checked = !all; });
      return;
    }
    if (!result) return;
    if (act === 'share') {
      if (navigator.canShare && navigator.canShare({ files: [result.file] })) {
        try { await navigator.share({ files: [result.file], title: result.name }); } catch (err) { if (err.name !== 'AbortError') toast('Nie udało się udostępnić', 'err'); }
      } else {
        downloadBlob(result.name, result.blob);
        toast('PDF pobrany');
      }
    }
    if (act === 'download') { downloadBlob(result.name, result.blob); toast('PDF pobrany'); }
  });
}
