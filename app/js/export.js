// .ics export, share summary, JSON backup file.

import { addDays, fmtRange, fmtDT, downloadBlob, splitDT, isDT, addMinutesDT, dateStr } from './util.js';
import { milestones, personById, roomById, exportBackup } from './store.js';

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
}
const enc = new TextEncoder();
function fold(line) {
  // RFC 5545 §3.1: lines longer than 75 OCTETS must be folded. Polish letters take
  // 2 bytes in UTF-8, so count bytes and never split inside a character.
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const icsDate = d => d.replace(/-/g, '');
const icsDT = s => s.replace(/[-:]/g, '') + '00';
function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function buildIcs(ev, { includeCalls = true } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jacob Light//Event Cal//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const add = (uidv, summary, start, end, allDay, desc = '', loc = '') => {
    lines.push('BEGIN:VEVENT', `UID:${uidv}@eventcal.jacoblight`, `DTSTAMP:${stamp()}`);
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(end)}`);
    } else {
      lines.push(`DTSTART:${icsDT(start)}`, `DTEND:${icsDT(end)}`);
    }
    lines.push(fold(`SUMMARY:${icsEscape(summary)}`));
    if (loc) lines.push(fold(`LOCATION:${icsEscape(loc)}`));
    if (desc) lines.push(fold(`DESCRIPTION:${icsEscape(desc)}`));
    lines.push('END:VEVENT');
  };
  const loc = [ev.venue, ev.address].filter(Boolean).join(', ');
  add(ev.id, ev.name, ev.startDate, addDays(ev.endDate, 1), true,
    [ev.client && `Klient: ${ev.client}`, ev.notes].filter(Boolean).join('\n'), loc);
  if (includeCalls) {
    // UID must be unique per VEVENT: two calls at the same minute used to share one UID
    // (kind + time) and the calendar silently kept only one of them. The milestone key
    // (call id, or kind) is unique and stable, so a re-import updates instead of duplicating.
    for (const m of milestones(ev)) {
      const who = m.personIds.length ? m.personIds.map(id => personById(ev, id)?.name).filter(Boolean).join(', ') : 'cała ekipa';
      add(`${ev.id}-${m.key || m.kind}`, `${m.label} · ${ev.name}`, m.dt, addMinutesDT(m.dt, 30), false, `Dotyczy: ${who}`, loc);
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export async function exportIcs(ev) {
  const ics = buildIcs(ev);
  const name = `${slug(ev.name)}.ics`;
  const file = new File([ics], name, { type: 'text/calendar' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: ev.name }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
  }
  downloadBlob(name, new Blob([ics], { type: 'text/calendar' }));
  return 'downloaded';
}

export function slug(s) {
  return String(s || 'event').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/gi, 'l')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'event';
}

export function summaryText(ev) {
  const t = ev.trip;
  const out = [`${ev.name}`, fmtRange(ev.startDate, ev.endDate)];
  if (ev.venue || ev.address) out.push([ev.venue, ev.address].filter(Boolean).join(', '));
  if (ev.client) out.push(`Klient: ${ev.client}`);
  const times = [['Montaż', ev.loadIn], ['Start show', ev.showStart], ['Koniec show', ev.showEnd], ['Demontaż', ev.loadOut]].filter(x => x[1]);
  if (times.length) out.push('', ...times.map(([k, v]) => `${k}: ${fmtDT(v)}`));
  if (t.departure.dt) out.push('', `Wyjazd: ${fmtDT(t.departure.dt)}${t.departure.place ? ' – ' + t.departure.place : ''}`);
  for (const v of t.vehicles) {
    const d = personById(ev, v.driverId)?.name;
    const ps = v.passengerIds.map(id => personById(ev, id)?.name).filter(Boolean);
    out.push(`• ${v.name}${v.plate ? ' (' + v.plate + ')' : ''}: ${d ? 'kier. ' + d : ''}${ps.length ? (d ? ', ' : '') + ps.join(', ') : ''}`);
  }
  if (t.hotel.name) out.push(`Hotel: ${t.hotel.name}${t.hotel.address ? ', ' + t.hotel.address : ''}`);
  if (t.calls.length) {
    out.push('', 'Calle:');
    for (const c of t.calls) out.push(`• ${fmtDT(c.dt)} – ${c.label}`);
  }
  if (ev.crew.length) {
    out.push('', 'Ekipa:');
    for (const p of ev.crew) {
      const room = roomById(ev, p.roomId);
      out.push(`• ${p.name}${p.role ? ' – ' + p.role : ''}${room ? ' – ' + room.name : ''}${p.phone ? ' – ' + p.phone : ''}`);
    }
  }
  if (ev.rooms.length) out.push('', `Sale (${ev.rooms.length}): ${ev.rooms.map(r => r.name).join(', ')}`);
  return out.join('\n');
}

export async function shareEvent(ev) {
  const text = summaryText(ev);
  if (navigator.share) {
    try { await navigator.share({ title: ev.name, text }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}

export async function downloadBackup(includeFiles = true) {
  const data = await exportBackup(includeFiles);
  const json = JSON.stringify(data);
  const name = `event-cal-backup-${dateStr(new Date())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Kopia Event Cal' }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
  }
  downloadBlob(name, new Blob([json], { type: 'application/json' }));
  return 'downloaded';
}

export { isDT, splitDT };
