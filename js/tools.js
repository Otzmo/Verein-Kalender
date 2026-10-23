// Statistik, Export, Import und Suche.
import { h, modal, btn, field, select, toast, download, errorText, slug } from './ui.js';
import { backend as b, fetchEvents, eventOps } from './data.js';
import { occurrences, parse, addDays, startOfDay } from './dates.js';
import { toICS, toCSV, parseICS } from './ics.js';

// Alle Termine aller lesbaren Unterkalender (nicht nur der geladene Zeitraum).
async function fetchAll(ctx, subcalIds = ctx.readableSubcals().map(s => s.id)) {
  const lists = await Promise.all(subcalIds.map(id => fetchEvents(ctx.calId, id, ctx.level(id) === 1)));
  return lists.flat();
}

// ---------- Suche ----------

export async function searchEvents(ctx, text) {
  const needle = text.toLowerCase();
  const today = startOfDay(new Date());
  const events = (await fetchAll(ctx, ctx.visibleSubcals().filter(s => ctx.level(s.id) >= 2).map(s => s.id)))
    .filter(ev => [ev.title, ev.location, ev.who, ev.notes].some(v => v?.toLowerCase().includes(needle)));
  const hits = events.map(ev => {
    // Bei Serien das nächste Vorkommen zeigen, sonst das erste.
    const next = occurrences(ev, today, addDays(today, 3660))[0];
    return next || occurrences(ev, parse(ev.start), addDays(parse(ev.start), 1))[0];
  }).filter(Boolean);
  return hits.sort((a, b2) => a.start - b2.start).slice(0, 200);
}

// ---------- Statistik ----------

export function openStats(ctx) {
  const y = new Date().getFullYear();
  const from = h('input', { type: 'date', value: `${y}-01-01` });
  const to = h('input', { type: 'date', value: `${y}-12-31` });
  const out = h('div', null, h('p', { class: 'muted' }, 'Wird berechnet …'));
  let events = null;

  const compute = () => {
    if (!events || !from.value || !to.value || to.value < from.value) return;
    const f = parse(from.value), t = addDays(parse(to.value), 1);
    const rows = new Map(ctx.readableSubcals().map(s => [s.id, { s, count: 0, minutes: 0, days: 0 }]));
    for (const ev of events) {
      const r = rows.get(ev.subcalId);
      if (!r) continue;
      for (const o of occurrences(ev, f, t)) {
        r.count++;
        if (ev.allDay) {
          for (let d = o.start < f ? f : o.start; d < o.end && d < t; d = addDays(d, 1)) r.days++;
        } else {
          const s = o.start < f ? f : o.start, e = o.end > t ? t : o.end;
          r.minutes += Math.max(0, Math.round((e - s) / 60000));
        }
      }
    }
    const list = [...rows.values()];
    const sum = k => list.reduce((acc, r) => acc + r[k], 0);
    const hours = m => (m / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 });
    out.replaceChildren(h('table', { class: 'stats-table' },
      h('thead', null, h('tr', null, h('th', null, 'Unterkalender'), h('th', null, 'Termine'), h('th', null, 'Stunden'), h('th', null, 'Ganztägige Tage'))),
      h('tbody', null, list.map(r => h('tr', null,
        h('td', null, h('span', { class: 'swatch', style: { background: r.s.color } }), ` ${r.s.name}`),
        h('td', null, r.count), h('td', null, hours(r.minutes)), h('td', null, r.days)))),
      h('tfoot', null, h('tr', null, h('th', null, 'Gesamt'), h('th', null, sum('count')), h('th', null, hours(sum('minutes'))), h('th', null, sum('days'))))),
    h('p', { class: 'hint' }, 'Serientermine zählen mit jedem Vorkommen. Stunden nur für Termine mit Uhrzeit.'));
  };
  from.addEventListener('change', compute);
  to.addEventListener('change', compute);

  const m = modal({
    title: 'Statistik',
    body: h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Von', from), field('Bis', to)), out),
    wide: true,
    actions: [btn('Schließen', () => m.close())],
  });
  fetchAll(ctx).then(list => { events = list; compute(); }).catch(e => out.replaceChildren(h('p', { class: 'error' }, errorText(e))));
}

// ---------- Export ----------

export function openExport(ctx) {
  const subs = ctx.readableSubcals();
  const checks = subs.map(s => [s, h('input', { type: 'checkbox', checked: !ctx.st.hidden.has(s.id) })]);
  const format = select([['ics', 'iCalendar (.ics) – für Outlook, Google, Apple'], ['csv', 'Excel (.csv)']], 'ics');
  const run = async () => {
    const ids = checks.filter(([, c]) => c.checked).map(([s]) => s.id);
    if (!ids.length) return toast('Bitte mindestens einen Unterkalender wählen.', 'error');
    try {
      const events = await fetchAll(ctx, ids);
      const name = slug(ctx.st.cal?.name || 'kalender');
      if (format.value === 'csv') download(`${name}.csv`, toCSV(events, ctx), 'text/csv;charset=utf-8');
      else download(`${name}.ics`, toICS(events, ctx), 'text/calendar;charset=utf-8');
      m.close();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const m = modal({
    title: 'Exportieren',
    body: h('div', { class: 'stack' },
      field('Format', format),
      h('div', null, h('div', { class: 'field-label' }, 'Unterkalender'),
        h('div', { class: 'checks' }, checks.map(([s, c]) => h('label', { class: 'check' }, c, ` ${s.name}`)))),
      h('p', { class: 'hint' }, 'Bei „ohne Details“ freigegebenen Unterkalendern werden nur die belegten Zeiten exportiert.')),
    actions: [btn('Abbrechen', () => m.close()), btn('Herunterladen', run, 'primary')],
  });
}

// ---------- Import ----------

export function openImport(ctx) {
  const subs = ctx.writableSubcals();
  const target = select(subs.map(s => [s.id, s.name]), subs[0]?.id);
  const info = h('p', { class: 'muted' }, 'Wähle eine .ics-Datei, z. B. einen Export aus Outlook, Google Kalender oder eine Ferienliste.');
  let parsed = [];
  const file = h('input', {
    type: 'file', accept: '.ics,text/calendar',
    onchange: async () => {
      parsed = [];
      const fl = file.files[0];
      if (!fl) return;
      try {
        parsed = parseICS(await fl.text());
        info.textContent = parsed.length ? `${parsed.length} Termine gefunden.` : 'In der Datei wurden keine Termine gefunden.';
      } catch (e) { info.textContent = `Die Datei konnte nicht gelesen werden: ${e.message}`; }
      importBtn.disabled = !parsed.length;
    },
  });
  const importBtn = btn('Importieren', async () => {
    importBtn.disabled = true;
    try {
      const ops = parsed.flatMap(ev => eventOps(ctx.calId, target.value, b.newId(), ev, ctx.uid));
      await b.batch(ops);
      toast(`${parsed.length} Termine importiert`);
      m.close();
    } catch (e) {
      toast(`Import fehlgeschlagen: ${errorText(e)}`, 'error');
      importBtn.disabled = false;
    }
  }, 'primary');
  importBtn.disabled = true;
  const m = modal({
    title: 'Importieren',
    body: h('div', { class: 'stack' }, field('Datei', file), info, field('In Unterkalender', target),
      h('p', { class: 'hint' }, 'Zeitzonen werden nicht umgerechnet (außer UTC-Zeiten). Komplexe Wiederholungsregeln, etwa „jeden 2. Montag im Monat“, werden vereinfacht übernommen.')),
    actions: [btn('Abbrechen', () => m.close()), importBtn],
  });
}
