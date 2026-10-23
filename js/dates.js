// Datumshilfen und Wiederholungen.
// Termine werden als Uhrzeit der Kalenderzeit gespeichert, ohne Zeitzonen-Umrechnung:
// ganztägig 'YYYY-MM-DD' (Ende = letzter Tag, inklusiv), sonst 'YYYY-MM-DDTHH:mm'.

const pad = n => String(n).padStart(2, '0');

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];

export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const ymdhm = d => `${ymd(d)}T${hm(d)}`;

export function parse(s) {
  const [date, time = '00:00'] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
export const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export function addMonths(d, n) {
  const y = d.getFullYear(), m = d.getMonth() + n;
  return new Date(y, m, Math.min(d.getDate(), daysInMonth(y, m)));
}
// Montag = 0 … Sonntag = 6
export const weekday = d => (d.getDay() + 6) % 7;
export const startOfWeek = d => addDays(startOfDay(d), -weekday(d));
export const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
export const sameDay = (a, b) => ymd(a) === ymd(b);
export const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
export const minutesOfDay = d => d.getHours() * 60 + d.getMinutes();

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

export const fmtDate = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
export const fmtShort = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
export const fmtDay = d => `${WEEKDAYS[weekday(d)]}, ${fmtDate(d)}`;
export const fmtLong = d => `${WEEKDAYS_LONG[weekday(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export function fmtOccurrence(o) {
  const { start, end } = o;
  if (o.ev.allDay) {
    const last = addDays(end, -1);
    return sameDay(start, last) ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(last)}`;
  }
  if (sameDay(start, end) || (minutesOfDay(end) === 0 && diffDays(start, end) === 1)) {
    return `${fmtDay(start)}, ${hm(start)}–${hm(end)} Uhr`;
  }
  return `${fmtDay(start)}, ${hm(start)} Uhr – ${fmtDay(end)}, ${hm(end)} Uhr`;
}

const FREQ = {
  daily: ['Täglich', 'Tage'],
  weekly: ['Wöchentlich', 'Wochen'],
  monthly: ['Monatlich', 'Monate'],
  yearly: ['Jährlich', 'Jahre'],
};

export function rruleText(r) {
  if (!r) return '';
  let t = r.interval > 1 ? `Alle ${r.interval} ${FREQ[r.freq][1]}` : FREQ[r.freq][0];
  if (r.freq === 'weekly' && r.byday?.length) t += ` am ${r.byday.map(i => WEEKDAYS[i]).join(', ')}`;
  if (r.until) t += ` bis ${fmtDate(parse(r.until))}`;
  else if (r.count) t += `, ${r.count}-mal`;
  return t;
}

const MAX_STEPS = 50000;

// Liefert alle Vorkommen eines Termins, die den Zeitraum [from, to) berühren.
// Ein Vorkommen: { ev, start, end (exklusiv), date: 'YYYY-MM-DD' des Beginns }.
export function occurrences(ev, from, to) {
  const start = parse(ev.start);
  const span = ev.allDay ? Math.max(0, diffDays(start, parse(ev.end))) + 1 : 0;
  const dur = ev.allDay ? 0 : Math.max(0, parse(ev.end) - start);
  const endOf = s => (ev.allDay ? addDays(s, span) : new Date(s.getTime() + dur));
  const out = [];
  const add = s => {
    const e = endOf(s);
    if ((e > from || (+e === +s && s >= from)) && s < to) out.push({ ev, start: s, end: e, date: ymd(s) });
  };

  const r = ev.rrule;
  if (!r) { add(start); return out; }

  const step = Math.max(1, r.interval || 1);
  const until = r.until ? addDays(parse(r.until), 1) : null;
  const ex = new Set(ev.exdates || []);
  let n = 0;
  // false beendet die Serie
  const emit = s => {
    if (s < start) return true;
    if ((until && s >= until) || (r.count && n >= r.count) || s >= to) return false;
    n++;
    if (!ex.has(ymd(s))) add(s);
    return true;
  };
  const at = (base, days) => {
    const d = addDays(base, days);
    d.setHours(start.getHours(), start.getMinutes());
    return d;
  };
  // Ohne Anzahl-Begrenzung kann bis kurz vor den Zeitraum gesprungen werden.
  const spanDays = ev.allDay ? span : Math.ceil(dur / 86400000);
  const lead = r.count ? 0 : Math.max(0, diffDays(start, from) - spanDays - 1);

  if (r.freq === 'daily') {
    for (let i = Math.floor(lead / step) * step, k = 0; k < MAX_STEPS; i += step, k++) {
      if (!emit(at(start, i))) break;
    }
  } else if (r.freq === 'weekly') {
    const days = (r.byday?.length ? [...r.byday] : [weekday(start)]).sort((a, b) => a - b);
    const w0 = startOfWeek(start);
    outer: for (let w = Math.floor(lead / 7 / step) * step, k = 0; k < MAX_STEPS; w += step, k++) {
      for (const d of days) if (!emit(at(w0, w * 7 + d))) break outer;
    }
  } else {
    const yearly = r.freq === 'yearly';
    const skip = Math.floor(lead / (yearly ? 366 : 31));
    for (let i = Math.floor(skip / step) * step, k = 0; k < MAX_STEPS; i += step, k++) {
      const s = yearly
        ? new Date(start.getFullYear() + i, start.getMonth(), start.getDate(), start.getHours(), start.getMinutes())
        : new Date(start.getFullYear(), start.getMonth() + i, start.getDate(), start.getHours(), start.getMinutes());
      if (s.getDate() !== start.getDate()) continue; // z. B. den 31. gibt es nicht in jedem Monat
      if (!emit(s)) break;
    }
  }
  return out;
}

// Letzter Tag, an dem ein Termin (oder seine Serie) noch stattfindet. Dient als Abfragefeld.
export function seriesEnd(ev) {
  const r = ev.rrule;
  if (!r) return ev.end.slice(0, 10);
  if (!r.until && !r.count) return '9999-12-31';
  const to = r.until ? addDays(parse(r.until), 2) : new Date(9999, 0, 1);
  const occ = occurrences({ ...ev, exdates: [] }, parse(ev.start), to);
  const last = occ[occ.length - 1];
  if (!last) return ev.end.slice(0, 10);
  return ymd(ev.allDay ? addDays(last.end, -1) : last.end);
}
