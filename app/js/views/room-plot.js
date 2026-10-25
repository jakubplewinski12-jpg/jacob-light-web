// "Plot" section of the room screen: upload / preview / full screen / replace / remove.
// The file is stored in IndexedDB (files, kind 'plot'); the room keeps { fileId, name, type, size, addedAt }.

import { esc, readFileAsArrayBuffer } from '../util.js';
import { icon } from '../icons.js';
import { saveEvent, saveFile, getFile, deleteFile } from '../store.js';
import { toast, confirmDialog } from '../ui.js';
import { PLOT_ACCEPT, plotKind, KIND_LABEL, mimeOf, readPlotProject, buildScene, plotPreview, canvasToBlob } from '../plotfile.js';

const MAX_BYTES = 40 * 1024 * 1024;
const thumbs = new Map(); // fileId -> object URL of a rendered PNG thumbnail

const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

function sectionHtml(room) {
  const p = room.plot;
  const input = `<input type="file" id="plot-input" accept="${PLOT_ACCEPT}" hidden>`;
  if (!p) {
    return `
      <div class="section-head"><h2 class="section-title">Plot</h2></div>
      <label class="card plain plot-empty" for="plot-input">
        ${icon('upload')}<span class="grow"><strong>Dodaj plot sali</strong>
        <small class="muted">Plik z Plot Designer (.plot) albo eksport PDF, PNG, JPG, SVG</small></span>
      </label>${input}`;
  }
  const kind = plotKind(p.name, p.type);
  return `
    <div class="section-head"><h2 class="section-title">Plot</h2><label class="link" for="plot-input">${icon('refresh')}Zastąp</label></div>
    <div class="card plot-card">
      <button class="plot-thumb plain" data-act="plot-open" aria-label="Otwórz plot na pełnym ekranie">
        <span class="plot-paper" data-plot-thumb="${esc(p.fileId)}"><span class="plot-loading muted small">Wczytuję podgląd…</span></span>
      </button>
      <div class="plot-meta">
        <span class="grow"><strong>${esc(p.name)}</strong>
        <small class="muted">${esc(KIND_LABEL[kind] || 'Plik')} · ${esc(kb(p.size))} · dodano ${esc(new Date(p.addedAt).toLocaleDateString('pl-PL'))}</small></span>
      </div>
      <div class="btn-grid">
        <button class="btn" data-act="plot-open">${icon('eye')}Pełny ekran</button>
        <button class="btn danger" data-act="plot-remove">${icon('trash')}Usuń</button>
      </div>
    </div>${input}`;
}

async function fillThumb(root, room) {
  const p = room.plot;
  const slot = p && root.querySelector(`[data-plot-thumb="${CSS.escape(p.fileId)}"]`);
  if (!slot) return;
  try {
    let url = thumbs.get(p.fileId);
    if (!url) {
      const f = await getFile(p.fileId);
      if (!f) throw new Error('Pliku planu nie ma w pamięci telefonu.');
      const { canvases } = await plotPreview(f, { longSide: 1100, cssW: 340, cssH: 240 });
      url = URL.createObjectURL(await canvasToBlob(canvases[0]));
      thumbs.set(p.fileId, url);
    }
    if (!slot.isConnected) return;
    slot.innerHTML = `<img src="${url}" alt="Plot – ${esc(room.name)}">`;
  } catch (e) {
    console.warn(e);
    if (slot.isConnected) slot.innerHTML = `<span class="plot-loading small">${icon('alert')}${esc(e.message || 'Nie udało się pokazać podglądu')}</span>`;
  }
}

/* ---------- full-screen viewer ---------- */

export async function openPlotViewer(room) {
  const p = room.plot;
  if (!p) return;
  const f = await getFile(p.fileId);
  if (!f) { toast('Pliku planu nie ma w pamięci telefonu', 'err'); return; }
  const kind = plotKind(f.name, f.type);
  const wrap = document.createElement('div');
  wrap.className = 'plot-viewer';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', `Plot – ${room.name}`);
  const origUrl = kind !== 'plot' ? URL.createObjectURL(new Blob([f.data], { type: f.type || mimeOf(kind) })) : '';
  wrap.innerHTML = `
    <div class="pv-bar">
      <button class="icon-btn" data-pv="close" aria-label="Zamknij">${icon('x')}</button>
      <div class="pv-title"><strong>${esc(room.name)}</strong><small>${esc(p.name)}</small></div>
      ${origUrl ? `<a class="icon-btn" href="${origUrl}" target="_blank" rel="noopener" aria-label="Otwórz oryginalny plik">${icon('share')}</a>` : '<span class="icon-btn" aria-hidden="true"></span>'}
    </div>
    <div class="pv-body" data-pv="body"><p class="muted center pad">Renderuję plot…</p></div>
    <p class="pv-hint">Stuknij plan, aby powiększyć</p>`;
  document.body.appendChild(wrap);
  const app = document.getElementById('app');
  app?.setAttribute('inert', '');
  document.body.classList.add('viewer-open');
  const urls = [];
  const close = () => {
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    app?.removeAttribute('inert');
    document.body.classList.remove('viewer-open');
    urls.forEach(u => URL.revokeObjectURL(u));
    if (origUrl) setTimeout(() => URL.revokeObjectURL(origUrl), 60000);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', e => {
    if (e.target.closest('[data-pv="close"]')) { close(); return; }
    const img = e.target.closest('.pv-page');
    if (img) wrap.querySelector('.pv-body').classList.toggle('zoom');
  });
  wrap.querySelector('[data-pv="close"]').focus();
  try {
    const long = Math.min(3200, Math.round(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 2) * 1.4));
    const res = await plotPreview(f, { longSide: long, maxPages: 8, cssW: 760, cssH: 540 });
    const imgs = [];
    for (const cv of res.canvases) {
      const u = URL.createObjectURL(await canvasToBlob(cv));
      urls.push(u);
      imgs.push(`<img class="pv-page" src="${u}" alt="Plot – ${esc(room.name)}">`);
    }
    let legend = '';
    if (res.scene) {
      const sc = res.scene;
      const meta = [sc.venue && `Obiekt: ${sc.venue}`, sc.designer && `Realizator: ${sc.designer}`].filter(Boolean).join(' · ');
      legend = `<div class="pv-legend">
        ${sc.title || meta ? `<p><strong>${esc(sc.title)}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}</p>` : ''}
        ${sc.legend.length ? `<ul>${sc.legend.map(g => `<li><span class="pv-sw" style="background:${esc(g.color)}"></span><span class="grow"><strong>${g.count} × ${esc(g.model)}</strong><small>${esc([g.brand, g.typeLabel, g.mode && `tryb ${g.mode}${g.ch ? ` (${g.ch} ch)` : ''}`, g.addrs.length && `DMX ${g.addrs.join(', ')}`].filter(Boolean).join(' · '))}</small></span></li>`).join('')}</ul>` : ''}
      </div>`;
    }
    const more = res.numPages > res.canvases.length ? `<p class="muted small center pad">Pokazano ${res.canvases.length} z ${res.numPages} stron – całość w oryginalnym pliku.</p>` : '';
    if (wrap.isConnected) wrap.querySelector('.pv-body').innerHTML = imgs.join('') + more + legend;
  } catch (e) {
    console.warn(e);
    if (wrap.isConnected) wrap.querySelector('.pv-body').innerHTML = `<p class="pad center">${esc(e.message || 'Nie udało się otworzyć planu.')}</p>`;
  }
}

/* ---------- upload / remove ---------- */

async function attach(ev, room, file) {
  const kind = plotKind(file.name, file.type);
  if (!kind) { toast('Obsługiwane: .plot, PDF, PNG, JPG, SVG', 'err'); return false; }
  if (file.size > MAX_BYTES) { toast('Plik jest za duży (maks. 40 MB)', 'err'); return false; }
  const buf = await readFileAsArrayBuffer(file);
  if (kind === 'plot') {
    const scene = buildScene(await readPlotProject(buf)); // throws a readable error for broken files
    if (scene.empty) toast('Plot jest pusty – zapisuję mimo to');
  }
  const type = mimeOf(kind, file.type);
  const id = await saveFile(ev.id, file.name, buf, type, 'plot');
  const old = room.plot?.fileId;
  room.plot = { fileId: id, name: file.name, type, size: buf.byteLength, addedAt: Date.now() };
  await saveEvent(ev);
  if (old) { try { await deleteFile(old); } catch { /* ignore */ } dropThumb(old); }
  toast(old ? 'Plot zastąpiony' : 'Plot dodany');
  return true;
}

function dropThumb(id) {
  const u = thumbs.get(id);
  if (u) { URL.revokeObjectURL(u); thumbs.delete(id); }
}

/** Removes the stored plot file of a room (used when the room itself is deleted). */
export async function removeRoomPlotFile(room) {
  const id = room?.plot?.fileId;
  if (!id) return;
  try { await deleteFile(id); } catch { /* ignore */ }
  dropThumb(id);
}

/** Mounts the plot section into `root` (a stable container that is not redrawn every minute). */
export function mountPlotSection(root, ev, room) {
  const draw = () => { root.innerHTML = sectionHtml(room); fillThumb(root, room); };
  root.onclick = async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'plot-open') { openPlotViewer(room); return; }
    if (t.dataset.act === 'plot-remove') {
      if (!(await confirmDialog(`Usunąć plot „${room.plot?.name}” z sali ${room.name}?`))) return;
      await removeRoomPlotFile(room);
      room.plot = null;
      await saveEvent(ev);
      toast('Plot usunięty');
      draw();
    }
  };
  root.onchange = async e => {
    if (e.target.id !== 'plot-input') return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const slot = root.querySelector('.plot-empty, .plot-paper');
    if (slot) slot.classList.add('is-busy');
    try {
      await attach(ev, room, file);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Nie udało się dodać planu', 'err');
    }
    draw();
  };
  draw();
}
