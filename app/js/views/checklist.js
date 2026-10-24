// Equipment checklist tab with templates.

import { esc, uid } from '../util.js';
import { icon } from '../icons.js';
import { CHECKLIST_TEMPLATES, buildChecklist } from '../templates.js';
import { openSheet, field, input, select, confirmDialog, toast } from '../ui.js';

export function html(ev) {
  const items = ev.checklist;
  const done = items.filter(i => i.done).length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  const groups = [...new Set(items.map(i => i.group))];
  const tplButtons = Object.keys(CHECKLIST_TEMPLATES).map(name =>
    `<button class="btn" data-act="ck-tpl" data-name="${esc(name)}">${icon('checklist')}${esc(name)}</button>`).join('');

  if (!items.length) {
    return `<div class="empty">${icon('checklist', 'empty-ic')}<h3>Lista sprzętu</h3><p>Zacznij od szablonu i dopasuj do wydarzenia.</p></div>
      <div class="stack">${tplButtons}<button class="btn ghost" data-act="ck-add">${icon('plus')}Pusta lista – dodaj pozycję</button></div>`;
  }
  return `
    <section class="card progress-card">
      <div class="row-between"><strong>${done} / ${items.length} spakowane</strong><span class="muted small">${pct}%</span></div>
      <div class="bar big"><i style="width:${pct}%"></i></div>
    </section>
    ${groups.map(g => `
      <h2 class="section-title">${esc(g)}</h2>
      <div class="card list">${items.filter(i => i.group === g).map(i => `
        <div class="list-row check-row ${i.done ? 'done' : ''}">
          <label class="check grow"><input type="checkbox" data-ck="${esc(i.id)}" ${i.done ? 'checked' : ''}><span class="box">${icon('check')}</span><span class="grow">${esc(i.text)}</span></label>
          <button class="icon-btn sm" data-act="ck-del" data-id="${esc(i.id)}" aria-label="Usuń pozycję">${icon('x')}</button>
        </div>`).join('')}</div>`).join('')}
    <div class="btn-grid">
      <button class="btn primary" data-act="ck-add">${icon('plus')}Dodaj pozycję</button>
      <button class="btn" data-act="ck-more">${icon('more')}Więcej</button>
    </div>`;
}

export function onChange(e, ctx) {
  const id = e.target.dataset?.ck;
  if (!id) return;
  const item = ctx.ev.checklist.find(i => i.id === id);
  if (!item) return;
  item.done = e.target.checked;
  ctx.save();
}

export async function handle(act, t, ctx) {
  const ev = ctx.ev;
  if (act === 'ck-tpl') {
    ev.checklist.push(...buildChecklist(t.dataset.name));
    await ctx.save();
    toast(`Dodano szablon „${t.dataset.name}”`);
    return true;
  }
  if (act === 'ck-del') {
    ev.checklist = ev.checklist.filter(i => i.id !== t.dataset.id);
    await ctx.save();
    return true;
  }
  if (act === 'ck-add') {
    const groups = [...new Set(ev.checklist.map(i => i.group))];
    openSheet({
      title: 'Nowa pozycja',
      body: field('Co', input('text', '', { placeholder: 'np. Zapasowa konsoleta' }))
        + (groups.length ? field('Grupa', select('group', [...groups.map(g => [g, g]), ['__new', '+ nowa grupa']], groups[groups.length - 1])) : '')
        + field('Nowa grupa (opcjonalnie)', input('newGroup', '', { placeholder: 'np. Efekty' })),
      actions: [{
        label: 'Dodaj', kind: 'primary', onClick: async api => {
          const d = api.data();
          if (!d.text) { toast('Wpisz pozycję', 'err'); return false; }
          const group = d.newGroup || (d.group && d.group !== '__new' ? d.group : 'Inne');
          ev.checklist.push({ id: uid('i_'), group, text: d.text, done: false });
          await ctx.save();
        }
      }]
    });
    return true;
  }
  if (act === 'ck-more') {
    openSheet({
      title: 'Lista sprzętu',
      body: `<div class="stack">
        ${Object.keys(CHECKLIST_TEMPLATES).map(name => `<button class="btn" data-tpl="${esc(name)}">${icon('plus')}Dołącz szablon: ${esc(name)}</button>`).join('')}
      </div>`,
      actions: [
        { label: 'Odznacz wszystko', kind: 'ghost', onClick: async () => { ev.checklist.forEach(i => { i.done = false; }); await ctx.save(); } },
        {
          label: 'Wyczyść listę', kind: 'danger', onClick: async () => {
            if (await confirmDialog('Usunąć wszystkie pozycje z listy?')) { ev.checklist = []; await ctx.save(); }
          }
        }
      ],
      onMount: api => {
        api.body.addEventListener('click', async e => {
          const b = e.target.closest('[data-tpl]');
          if (!b) return;
          ev.checklist.push(...buildChecklist(b.dataset.tpl));
          api.close();
          await ctx.save();
          toast('Szablon dołączony');
        });
      }
    });
    return true;
  }
  return false;
}
