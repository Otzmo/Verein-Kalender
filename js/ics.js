// iCalendar (.ics) und CSV: Export und Import.
import { parse, ymd, ymdhm, addDays, addMinutes, fmtDate, hm } from './dates.js';

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unesc = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const compactDate = s => s.slice(0, 10).replace(/-/g, '');
const compactDateTime = s => `${compactDate(s)}T${s.slice(11, 13)}${s.slice(14, 16)}00`;
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const FREQ = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };

// Zeilen dürfen höchstens 75 Zeichen lang sein, Folgezeilen beginnen mit Leerzeichen.
function fold(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ` ${line.slice(74)}`; }
  out.push(line);
  return out.join('\r\n');
}

export function toICS(events, ctx) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kalender//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(ctx.st.cal?.name || 'Kalender')}`];
  for (const ev of events) {
    const date = s => (ev.allDay ? `;VALUE=DATE:${compactDate(s)}` : `:${compactDateTime(s)}`);
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@kalender`, `DTSTAMP:${stamp}`,
      `DTSTART${date(ev.start)}`,
      `DTEND${ev.allDay ? date(ymd(addDays(parse(ev.end), 1))) : date(ev.end)}`,
      `SUMMARY:${esc(ev.busy ? 'Belegt' : ev.title)}`);
    if (!ev.busy) {
      if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
      const desc = [ev.who && `Wer: ${ev.who}`, ev.notes].filter(Boolean).join('\n');
      if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    }
    const sc = ctx.subcal(ev.subcalId);
    if (sc) lines.push(`CATEGORIES:${esc(sc.name)}`);
    if (ev.rrule) {
      const r = ev.rrule;
      let rule = `FREQ=${FREQ[r.freq]};INTERVAL=${r.interval || 1}`;
      if (r.freq === 'weekly' && r.byday?.length) rule += `;BYDAY=${r.byday.map(d => DAYS[d]).join(',')}`;
      if (r.until) rule += `;UNTIL=${compactDate(r.until)}${ev.allDay ? '' : 'T235959'}`;
      else if (r.count) rule += `;COUNT=${r.count}`;
      lines.push(`RRULE:${rule}`);
      for (const x of ev.exdates || []) lines.push(`EXDATE${ev.allDay ? `;VALUE=DATE:${compactDate(x)}` : `:${compactDate(x)}T${compactDateTime(ev.start).slice(9)}`}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function toCSV(events, ctx) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const when = (s, allDay) => (allDay ? fmtDate(parse(s)) : `${fmtDate(parse(s))} ${hm(parse(s))}`);
  const rows = [['Unterkalender', 'Titel', 'Beginn', 'Ende', 'Ganztägig', 'Ort', 'Wer', 'Beschreibung', 'Wiederholung']];
  for (const ev of events) {
    rows.push([ctx.subcal(ev.subcalId)?.name, ev.busy ? 'Belegt' : ev.title, when(ev.start, ev.allDay), when(ev.end, ev.allDay),
      ev.allDay ? 'ja' : 'nein', ev.location, ev.who, ev.notes, ev.rrule ? ev.rrule.freq : '']);
  }
  // BOM und Semikolon, damit Excel in deutscher Einstellung Umlaute und Spalten richtig erkennt.
  return '\uFEFF' + rows.map(r => r.map(q).join(';')).join('\r\n');
}

// ---------- Import ----------

function icsDate(value, params) {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    return { value: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const d = m[7]
    ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) // UTC in lokale Zeit umrechnen
    : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return { value: ymdhm(d), allDay: false };
}

function durationMinutes(v) {
  const m = v.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!m) return 60;
  return (+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function toEvent(props) {
  const first = name => props[name]?.[0];
  const ds = first('DTSTART');
  if (!ds) return null;
  const start = icsDate(ds.value, ds.params);
  if (!start) return null;
  let end;
  const de = first('DTEND');
  if (de) end = icsDate(de.value, de.params)?.value;
  if (start.allDay) {
    end = end ? ymd(addDays(parse(end), -1)) : start.value; // DTEND ist bei Ganztägigen exklusiv
    if (!de && first('DURATION')) end = ymd(addDays(parse(start.value), Math.max(1, Math.round(durationMinutes(first('DURATION').value) / 1440)) - 1));
    if (end < start.value) end = start.value;
  } else {
    if (!end) end = ymdhm(addMinutes(parse(start.value), first('DURATION') ? durationMinutes(first('DURATION').value) : 60));
    if (end.length === 10) end = `${end}T00:00`;
    if (end < start.value) end = start.value;
  }

  let rrule = null;
  const rr = first('RRULE');
  if (rr) {
    const p = Object.fromEntries(rr.value.split(';').map(x => x.split('=')));
    const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[p.FREQ];
    if (freq) {
      const byday = freq === 'weekly' && p.BYDAY ? p.BYDAY.split(',').map(d => DAYS.indexOf(d.replace(/^[+-]?\d+/, ''))).filter(i => i >= 0) : [];
      rrule = {
        freq,
        interval: Number(p.INTERVAL) || 1,
        byday: freq === 'weekly' ? (byday.length ? byday : [((parse(start.value).getDay() + 6) % 7)]) : [],
        until: p.UNTIL ? icsDate(p.UNTIL, {})?.value.slice(0, 10) || null : null,
        count: p.COUNT ? Number(p.COUNT) : null,
      };
    }
  }
  const exdates = (props.EXDATE || []).flatMap(x => x.value.split(',')).map(v => icsDate(v, {})?.value.slice(0, 10)).filter(Boolean);
  const text = name => (first(name) ? unesc(first(name).value) : '');
  return {
    title: text('SUMMARY'), start: start.value, end, allDay: start.allDay, rrule, exdates,
    location: text('LOCATION'), who: '', notes: text('DESCRIPTION'), signup: null,
  };
}

export function parseICS(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; } // z. B. VALARM überspringen
    if (line.startsWith('END:') && depth) { depth--; continue; }
    if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (depth) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const p = Object.fromEntries(params.map(x => { const j = x.indexOf('='); return [x.slice(0, j).toUpperCase(), x.slice(j + 1)]; }));
    (cur[name.toUpperCase()] ||= []).push({ value: line.slice(i + 1), params: p });
  }
  return events.map(toEvent).filter(Boolean);
}
