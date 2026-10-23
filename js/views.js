// Kalenderansichten: Tag, Woche, Monat, Jahr, Liste, Planer und Suchergebnisse.
import { h } from './ui.js';
import {
  ymd, hm, addDays, addMonths, startOfDay, startOfWeek, startOfMonth, weekday, sameDay, diffDays,
  isoWeek, minutesOfDay, fmtShort, fmtDay, fmtLong, fmtOccurrence, WEEKDAYS, MONTHS,
} from './dates.js';

export const VIEWS = [['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr'], ['list', 'Liste'], ['planner', 'Planer']];
const HOUR = 44; // Pixel pro Stunde im Zeitraster
const MONTH_MAX = 4; // Termine pro Tag in der Monatsansicht, danach "+n weitere"

export function viewRange(view, cursor) {
  if (view === 'day') { const f = startOfDay(cursor); return { from: f, to: addDays(f, 1) }; }
  if (view === 'week') { const f = startOfWeek(cursor); return { from: f, to: addDays(f, 7) }; }
  if (view === 'planner') { const f = startOfWeek(cursor); return { from: f, to: addDays(f, 14) }; }
  if (view === 'year') return { from: new Date(cursor.getFullYear(), 0, 1), to: new Date(cursor.getFullYear() + 1, 0, 1) };
  if (view === 'list') { const f = startOfMonth(cursor); return { from: f, to: addMonths(f, 1) }; }
  const f = startOfWeek(startOfMonth(cursor));
  return { from: f, to: addDays(f, 42) };
}

export function stepCursor(view, cursor, dir) {
  if (view === 'day') return addDays(cursor, dir);
  if (view === 'week' || view === 'planner') return addDays(cursor, 7 * dir);
  if (view === 'year') return addMonths(cursor, 12 * dir);
  return addMonths(cursor, dir);
}

export function viewTitle(view, cursor) {
  const { from, to } = viewRange(view, cursor);
  const last = addDays(to, -1);
  if (view === 'day') return fmtLong(cursor);
  if (view === 'week') return `KW ${isoWeek(from)} · ${fmtShort(from)} – ${fmtShort(last)}${last.getFullYear()}`;
  if (view === 'planner') return `${fmtShort(from)} – ${fmtShort(last)}${last.getFullYear()}`;
  if (view === 'year') return String(cursor.getFullYear());
  return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
}

export function renderView(ctx, view, root) {
  const render = { day: renderDay, week: renderWeek, year: renderYear, list: renderList, planner: renderPlanner }[view] || renderMonth;
  render(ctx, root);
}

// ---------- Bausteine ----------

export function textOn(hex) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1d2430' : '#ffffff';
}

const colorOf = (ctx, o) => ctx.subcal(o.ev.subcalId)?.color || '#888888';
const titleOf = o => (o.ev.busy ? 'Belegt' : o.ev.title || '(ohne Titel)');
const realEnd = o => (o.end > o.start ? o.end : new Date(o.start.getTime() + 60000));

function draggable(ctx, el, o, day) {
  if (!ctx.canEdit(o.ev)) return;
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    ctx.drag = { occ: o, day, grabY: e.clientY - el.getBoundingClientRect().top };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', o.ev.id);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); ctx.drag = null; });
}

function dropZone(ctx, el, accept, onDrop) {
  el.addEventListener('dragover', e => {
    if (ctx.drag && accept(ctx.drag.occ)) { e.preventDefault(); el.classList.add('drop'); }
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drop');
    if (ctx.drag && accept(ctx.drag.occ)) onDrop(ctx.drag, e);
  });
}

function chip(ctx, o, day, { showTime = true } = {}) {
  const color = colorOf(ctx, o);
  const solid = o.ev.allDay;
  const time = !solid && showTime && sameDay(o.start, day) ? hm(o.start) : '';
  const cls = ['chip', solid ? 'solid' : 'dot', o.ev.busy && 'busy',
    solid && o.start < day && 'cont-left', solid && o.end > addDays(day, 1) && 'cont-right'].filter(Boolean).join(' ');
  const el = h('div', {
    class: cls,
    style: solid ? { background: color, color: textOn(color) } : { '--c': color },
    title: `${time ? time + ' ' : ''}${titleOf(o)}`,
    onclick: e => { e.stopPropagation(); ctx.openEvent(o); },
  },
  solid ? null : h('span', { class: 'dotmark' }),
  time ? h('span', { class: 'chip-time' }, time) : null,
  h('span', { class: 'chip-title' }, titleOf(o)));
  draggable(ctx, el, o, day);
  return el;
}

// Ordnet Vorkommen den Tagen zu, an denen sie stattfinden.
function bucketByDay(occs, from, to, keyOf = () => '') {
  const m = new Map();
  for (const o of occs) {
    const end = realEnd(o);
    for (let d = startOfDay(o.start < from ? from : o.start); d < end && d < to; d = addDays(d, 1)) {
      const k = keyOf(o) + ymd(d);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(o);
    }
  }
  for (const list of m.values()) list.sort((a, b) => (b.ev.allDay - a.ev.allDay) || (a.start - b.start));
  return m;
}

const dayClasses = (base, day, today, extra = []) =>
  [base, ymd(day) === today && 'today', weekday(day) >= 5 && 'weekend', ...extra].filter(Boolean).join(' ');

const holidayLine = names => (names.length ? h('div', { class: 'holiday', title: names.join(', ') }, names.join(', ')) : null);

// ---------- Monat ----------

function renderMonth(ctx, root) {
  const cursor = ctx.st.cursor;
  const { from, to } = viewRange('month', cursor);
  const buckets = bucketByDay(ctx.occurrences(from, to), from, to);
  const today = ymd(new Date());
  const rows = [];
  for (let w = 0; w < 6; w++) {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(from, w * 7 + i);
      const items = buckets.get(ymd(day)) || [];
      const hol = ctx.holidays(day);
      const shown = items.length > MONTH_MAX ? items.slice(0, MONTH_MAX - 1) : items;
      const cell = h('div', {
        class: dayClasses('month-cell', day, today, [day.getMonth() !== cursor.getMonth() && 'other']),
        onclick: () => ctx.openNew({ date: ymd(day), allDay: true }),
      },
      h('div', { class: 'cell-head' },
        i === 0 ? h('span', { class: 'kw' }, `KW ${isoWeek(day)}`) : h('span'),
        h('button', { type: 'button', class: `daynum${hol.length ? ' hol' : ''}`, title: 'Tagesansicht', onclick: e => { e.stopPropagation(); ctx.goto(day, 'day'); } }, day.getDate())),
      holidayLine(hol),
      shown.map(o => chip(ctx, o, day)),
      items.length > shown.length
        ? h('button', { type: 'button', class: 'more', onclick: e => { e.stopPropagation(); ctx.goto(day, 'day'); } }, `+${items.length - shown.length} weitere`)
        : null);
      dropZone(ctx, cell, () => true, d => ctx.moveTo(d.occ, addDays(d.occ.start, diffDays(d.day, day))));
      cells.push(cell);
    }
    rows.push(h('div', { class: 'month-row' }, cells));
  }
  root.replaceChildren(h('div', { class: 'month' },
    h('div', { class: 'month-head' }, WEEKDAYS.map(w => h('div', null, w))),
    rows));
}

// ---------- Tag und Woche ----------

function renderDay(ctx, root) { renderTimeGrid(ctx, root, [startOfDay(ctx.st.cursor)]); }
function renderWeek(ctx, root) {
  const f = startOfWeek(ctx.st.cursor);
  renderTimeGrid(ctx, root, Array.from({ length: 7 }, (_, i) => addDays(f, i)));
}

// Verteilt überlappende Termine nebeneinander.
function layoutColumns(segs) {
  segs.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group = [], groupEnd = -1;
  const finish = () => {
    const cols = [];
    for (const s of group) {
      let i = cols.findIndex(end => end <= s.top);
      if (i < 0) { i = cols.length; cols.push(0); }
      cols[i] = s.bottom;
      s.col = i;
    }
    group.forEach(s => { s.cols = cols.length; });
  };
  for (const s of segs) {
    if (group.length && s.top >= groupEnd) { finish(); group = []; groupEnd = -1; }
    group.push(s);
    groupEnd = Math.max(groupEnd, s.bottom);
  }
  if (group.length) finish();
  return segs;
}

function renderTimeGrid(ctx, root, days) {
  const from = days[0], to = addDays(days[days.length - 1], 1);
  const occs = ctx.occurrences(from, to);
  const allDay = bucketByDay(occs.filter(o => o.ev.allDay), from, to);
  const timed = occs.filter(o => !o.ev.allDay);
  const today = ymd(new Date());
  const now = new Date();
  const style = { '--days': days.length };

  const head = h('div', { class: 'tg-row tg-head', style },
    h('div', { class: 'tg-gutter' }),
    days.map(d => {
      const hol = ctx.holidays(d);
      return h('div', { class: dayClasses('tg-dayhead', d, today) },
        h('button', { type: 'button', class: 'tg-daylink', onclick: () => ctx.goto(d, 'day') },
          h('span', { class: 'wd' }, WEEKDAYS[weekday(d)]), h('span', { class: `dn${hol.length ? ' hol' : ''}` }, d.getDate())),
        holidayLine(hol));
    }));

  const allDayRow = h('div', { class: 'tg-row tg-allday', style },
    h('div', { class: 'tg-gutter' }, 'ganztägig'),
    days.map(d => {
      const cell = h('div', { class: dayClasses('tg-allcell', d, today), onclick: () => ctx.openNew({ date: ymd(d), allDay: true }) },
        (allDay.get(ymd(d)) || []).map(o => chip(ctx, o, d)));
      dropZone(ctx, cell, o => o.ev.allDay, drag => ctx.moveTo(drag.occ, addDays(drag.occ.start, diffDays(drag.day, d))));
      return cell;
    }));

  const cols = days.map(d => {
    const dayEnd = addDays(d, 1);
    const segs = timed.filter(o => o.start < dayEnd && realEnd(o) > d).map(o => {
      const top = o.start < d ? 0 : minutesOfDay(o.start);
      const bottom = realEnd(o) >= dayEnd ? 1440 : minutesOfDay(realEnd(o));
      return { o, top, bottom: Math.max(bottom, top + 22) };
    });
    const col = h('div', {
      class: dayClasses('tg-col', d, today),
      onclick: e => {
        const min = Math.floor((e.clientY - col.getBoundingClientRect().top) / HOUR * 2) * 30;
        ctx.openNew({ date: ymd(d), time: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}` });
      },
    },
    layoutColumns(segs).map(({ o, top, bottom, col: c, cols: n }) => {
      const color = colorOf(ctx, o);
      const el = h('div', {
        class: `tg-event${o.ev.busy ? ' busy' : ''}`,
        style: {
          top: `${top / 60 * HOUR}px`, height: `${(bottom - top) / 60 * HOUR - 2}px`,
          left: `calc(${c / n * 100}% + 1px)`, width: `calc(${100 / n}% - 3px)`,
          background: color, color: textOn(color),
        },
        title: `${hm(o.start)}–${hm(o.end)} ${titleOf(o)}`,
        onclick: e => { e.stopPropagation(); ctx.openEvent(o); },
      },
      h('div', { class: 'ev-time' }, `${hm(o.start)}–${hm(o.end)}`),
      h('div', { class: 'ev-title' }, titleOf(o)),
      o.ev.location && !o.ev.busy ? h('div', { class: 'ev-loc' }, o.ev.location) : null);
      draggable(ctx, el, o, d);
      return el;
    }),
    ymd(d) === today ? h('div', { class: 'now-line', style: { top: `${minutesOfDay(now) / 60 * HOUR}px` } }) : null);
    dropZone(ctx, col, o => !o.ev.allDay, (drag, e) => {
      let min = Math.round((e.clientY - col.getBoundingClientRect().top - (drag.grabY || 0)) / HOUR * 4) * 15;
      min = Math.min(Math.max(min, 0), 1440 - 15);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min);
      ctx.moveTo(drag.occ, start);
    });
    return col;
  });

  const scroll = h('div', { class: 'tg-scroll', onscroll: () => { ctx.st.gridScroll = scroll.scrollTop; } },
    h('div', { class: 'tg-row tg-grid', style: { ...style, height: `${24 * HOUR}px`, '--hour': `${HOUR}px` } },
      h('div', { class: 'tg-gutter tg-hours' }, Array.from({ length: 24 }, (_, i) => h('div', { class: 'tg-hour', style: { top: `${i * HOUR}px` } }, i ? `${String(i).padStart(2, '0')}:00` : ''))),
      cols));

  root.replaceChildren(h('div', { class: `tg${days.length === 1 ? ' tg-single' : ''}` }, head, allDayRow, scroll));
  scroll.scrollTop = ctx.st.gridScroll ?? 7 * HOUR;
}

// ---------- Liste ----------

function agendaList(ctx, from, to) {
  const buckets = bucketByDay(ctx.occurrences(from, to), from, to);
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const items = buckets.get(ymd(d)) || [];
    const hol = ctx.holidays(d);
    if (!items.length && !hol.length) continue;
    out.push(h('section', { class: dayClasses('agenda-day', d, ymd(new Date())) },
      h('h3', null, h('button', { type: 'button', class: 'link-btn', onclick: () => ctx.goto(d, 'day') }, fmtDay(d)), hol.length ? h('span', { class: 'holiday inline' }, hol.join(', ')) : null),
      items.map(o => agendaItem(ctx, o, d))));
  }
  return out;
}

function agendaItem(ctx, o, day) {
  let time = 'ganztägig';
  if (!o.ev.allDay) {
    const s = sameDay(o.start, day) ? hm(o.start) : '…';
    const e = sameDay(realEnd(o), day) || minutesOfDay(o.end) === 0 && diffDays(day, o.end) === 1 ? hm(o.end) : '…';
    time = `${s}–${e}`;
  }
  const sc = ctx.subcal(o.ev.subcalId);
  return h('button', { type: 'button', class: `agenda-item${o.ev.busy ? ' busy' : ''}`, onclick: () => ctx.openEvent(o) },
    h('span', { class: 'agenda-time' }, time),
    h('span', { class: 'swatch', style: { background: colorOf(ctx, o) } }),
    h('span', { class: 'agenda-main' },
      h('span', { class: 'agenda-title' }, titleOf(o)),
      !o.ev.busy && o.ev.location ? h('span', { class: 'muted' }, ` · ${o.ev.location}`) : null),
    h('span', { class: 'agenda-sub muted' }, sc?.name || ''));
}

function renderList(ctx, root) {
  const { from, to } = viewRange('list', ctx.st.cursor);
  const days = agendaList(ctx, from, to);
  root.replaceChildren(h('div', { class: 'agenda' }, days.length ? days : h('p', { class: 'empty' }, 'Keine Termine in diesem Monat.')));
}

// ---------- Jahr ----------

function renderYear(ctx, root) {
  const y = ctx.st.cursor.getFullYear();
  const { from, to } = viewRange('year', ctx.st.cursor);
  const buckets = bucketByDay(ctx.occurrences(from, to), from, to);
  const today = ymd(new Date());
  const months = Array.from({ length: 12 }, (_, m) => {
    const first = new Date(y, m, 1);
    const cells = Array.from({ length: weekday(first) }, () => h('span'));
    for (let d = first; d.getMonth() === m; d = addDays(d, 1)) {
      const day = d;
      const items = buckets.get(ymd(day)) || [];
      const hol = ctx.holidays(day);
      const colors = [...new Set(items.map(o => colorOf(ctx, o)))].slice(0, 3);
      const tip = [hol.join(', '), items.length ? `${items.length} Termin${items.length > 1 ? 'e' : ''}` : ''].filter(Boolean).join(' · ');
      cells.push(h('button', {
        type: 'button',
        class: dayClasses('ym-day', day, today, [items.length && 'has', hol.length && 'hol']),
        title: tip || null,
        onclick: () => ctx.goto(day, 'day'),
      }, day.getDate(), colors.length ? h('span', { class: 'ym-dots' }, colors.map(c => h('i', { style: { background: c } }))) : null));
    }
    return h('div', { class: 'ym' },
      h('button', { type: 'button', class: 'ym-title link-btn', onclick: () => ctx.goto(first, 'month') }, MONTHS[m]),
      h('div', { class: 'ym-grid' }, WEEKDAYS.map(w => h('span', { class: 'ym-wd' }, w[0])), cells));
  });
  root.replaceChildren(h('div', { class: 'year' }, months));
}

// ---------- Planer ----------

function renderPlanner(ctx, root) {
  const { from, to } = viewRange('planner', ctx.st.cursor);
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const buckets = bucketByDay(ctx.occurrences(from, to), from, to, o => o.ev.subcalId + '|');
  const subs = ctx.visibleSubcals();
  const today = ymd(new Date());
  const head = h('div', { class: 'pl-row pl-head' },
    h('div', { class: 'pl-name' }),
    days.map(d => h('div', { class: dayClasses('pl-cell', d, today, [ctx.holidays(d).length && 'hol']), title: ctx.holidays(d).join(', ') || null },
      h('span', { class: 'wd' }, WEEKDAYS[weekday(d)]), ` ${fmtShort(d)}`)));
  const rows = subs.map(s => h('div', { class: 'pl-row' },
    h('div', { class: 'pl-name' }, h('span', { class: 'swatch', style: { background: s.color } }), h('span', null, s.name)),
    days.map(d => {
      const cell = h('div', {
        class: dayClasses('pl-cell', d, today),
        onclick: () => ctx.openNew({ date: ymd(d), allDay: true, subcalId: s.id }),
      }, (buckets.get(`${s.id}|${ymd(d)}`) || []).map(o => chip(ctx, o, d, { showTime: false })));
      dropZone(ctx, cell, () => true, drag => ctx.moveTo(drag.occ, addDays(drag.occ.start, diffDays(drag.day, d)), s.id));
      return cell;
    })));
  root.replaceChildren(h('div', { class: 'planner' },
    h('div', { class: 'pl-table' }, head, rows.length ? rows : h('p', { class: 'empty' }, 'Keine Unterkalender sichtbar.'))));
}

// ---------- Suche ----------

export function renderResults(ctx, root, results) {
  root.replaceChildren(h('div', { class: 'agenda' },
    results.length
      ? results.map(o => h('button', { type: 'button', class: 'agenda-item', onclick: () => { ctx.goto(o.start, 'day'); ctx.openEvent(o); } },
        h('span', { class: 'agenda-time' }, `${fmtShort(o.start)}${o.start.getFullYear()}`),
        h('span', { class: 'swatch', style: { background: colorOf(ctx, o) } }),
        h('span', { class: 'agenda-main' }, h('span', { class: 'agenda-title' }, titleOf(o)), h('span', { class: 'muted' }, ` · ${fmtOccurrence(o)}`)),
        h('span', { class: 'agenda-sub muted' }, ctx.subcal(o.ev.subcalId)?.name || '')))
      : h('p', { class: 'empty' }, 'Keine passenden Termine gefunden.')));
}
