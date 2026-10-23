// Kalenderseite: Kopfzeile, Unterkalender-Leiste, Ansichten und Live-Abos.
import { h, fill, toast, choiceDialog, popover, store, errorText } from './ui.js';
import { backend as b, watchCalendar, watchSubcals, watchEvents, saveEvent, moveEvent, eventOps, LEVEL_LABELS } from './data.js';
import { occurrences, parse, ymd, ymdhm, addDays, diffDays, startOfDay, minutesOfDay } from './dates.js';
import { holidayNames } from './holidays.js';
import { VIEWS, viewRange, stepCursor, viewTitle, renderView, renderResults } from './views.js';
import { openEventDetail, openEventEditor } from './event-dialog.js';
import { openSettings } from './settings.js';
import { openStats, openExport, openImport, searchEvents } from './tools.js';

const PERM_ICON = ['', '◐', '🔒', '＋', ''];
const VIEW_KEYS = VIEWS.map(([v]) => v);

// access: { owner, admin, perms: {subcalId: level}, defaultLevel, bookTarget }
export function startCalendar({ root, calId, access, user, query, onCleanup, app }) {
  const st = {
    cal: null,
    subcals: [],
    events: new Map(),
    view: VIEW_KEYS.includes(query.get('view')) ? query.get('view') : null,
    cursor: /^\d{4}-\d{2}-\d{2}$/.test(query.get('date') || '') ? parse(query.get('date')) : startOfDay(new Date()),
    hidden: new Set(store.get(`kd-hidden-${calId}`) || []),
    subs: new Map(),
    subFrom: null,
    search: '',
    results: null,
    gridScroll: null,
  };
  const embed = query.get('embed') === '1';
  document.body.classList.toggle('embed', embed);

  const ctx = {
    calId, access, st, uid: user.uid,
    isAdmin: !!(access.owner || access.admin),
    drag: null,
    level: s => (access.owner || access.admin ? 4 : access.perms?.[s] ?? access.defaultLevel ?? 0),
    canCreateIn: s => ctx.level(s) >= 3,
    canEdit: ev => !ev.busy && (ctx.level(ev.subcalId) >= 4 || (ctx.level(ev.subcalId) >= 3 && ev.createdBy === user.uid)),
    subcal: id => st.subcals.find(s => s.id === id),
    readableSubcals: () => st.subcals.filter(s => ctx.level(s.id) >= 1),
    visibleSubcals: () => ctx.readableSubcals().filter(s => !st.hidden.has(s.id)),
    writableSubcals: () => st.subcals.filter(s => ctx.level(s.id) >= 3),
    occurrences(from, to) {
      const out = [];
      for (const s of ctx.visibleSubcals()) {
        for (const ev of st.events.get(s.id) || []) out.push(...occurrences(ev, from, to));
      }
      return out.sort((x, y) => (x.start - y.start) || (y.ev.allDay - x.ev.allDay) || (y.end - x.end));
    },
    holidays: d => holidayNames(st.cal?.settings?.holidays, d),
    openEvent: o => openEventDetail(ctx, o),
    openNew(defaults = {}) {
      if (!ctx.writableSubcals().length) return;
      openEventEditor(ctx, { defaults });
    },
    goto(date, view) {
      st.cursor = startOfDay(date);
      if (view) st.view = view;
      clearSearch(false);
      changed();
    },
    moveTo,
  };

  // ---------- Gerüst ----------

  const titleEl = h('h1', { class: 'view-title' });
  const calNameEl = h('div', { class: 'cal-name' });
  const viewBtns = VIEWS.map(([v, label]) => h('button', { type: 'button', class: 'seg', dataset: { v }, onclick: () => ctx.goto(st.cursor, v) }, label));
  const searchInput = h('input', {
    type: 'search', class: 'search', placeholder: 'Suchen …', 'aria-label': 'Termine durchsuchen',
    onkeydown: e => { if (e.key === 'Enter') runSearch(); },
    oninput: e => { if (!e.target.value) clearSearch(); },
  });
  const sidebar = h('aside', { class: 'sidebar' });
  const main = h('main', { class: 'view' });
  const shell = h('div', { class: 'cal-app' },
    h('header', { class: 'topbar' },
      h('div', { class: 'tb-left' },
        h('button', { type: 'button', class: 'icon-btn sb-toggle', title: 'Unterkalender', 'aria-label': 'Unterkalender anzeigen', onclick: () => shell.classList.toggle('sb-open') }, '☰'),
        calNameEl),
      h('div', { class: 'tb-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.goto(new Date()) }, 'Heute'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Zurück', 'aria-label': 'Zurück', onclick: () => step(-1) }, '‹'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Weiter', 'aria-label': 'Weiter', onclick: () => step(1) }, '›'),
        titleEl),
      h('div', { class: 'tb-right' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Ansicht' }, viewBtns),
        searchInput,
        h('button', { type: 'button', class: 'icon-btn', title: 'Menü', 'aria-label': 'Menü', onclick: e => openMenu(e.currentTarget) }, '⋮'))),
    h('div', { class: 'cal-body' },
      sidebar,
      h('div', { class: 'sb-backdrop', onclick: () => shell.classList.remove('sb-open') }),
      main));
  root.replaceChildren(shell);

  function openMenu(anchor) {
    popover(anchor, [
      ctx.isAdmin && { label: 'Einstellungen', action: () => openSettings(ctx) },
      { label: 'Statistik', action: () => openStats(ctx) },
      { label: 'Exportieren (iCal / Excel)', action: () => openExport(ctx) },
      ctx.writableSubcals().length && { label: 'Importieren (iCal)', action: () => openImport(ctx) },
      { label: 'Drucken / PDF', action: () => window.print() },
      '-',
      { label: app.isDark() ? 'Heller Modus' : 'Dunkler Modus', action: () => app.toggleTheme() },
      access.owner && '-',
      access.owner && { label: 'Alle Kalender', action: () => { location.hash = '#/'; } },
      access.owner && { label: 'Abmelden', action: () => app.signOut() },
    ]);
  }

  // ---------- Darstellung ----------

  function renderSidebar() {
    const subs = ctx.readableSubcals();
    const allShown = subs.every(s => !st.hidden.has(s.id));
    fill(sidebar,
      ctx.writableSubcals().length ? h('button', { type: 'button', class: 'btn primary block', onclick: () => ctx.openNew({ date: ymd(st.view === 'day' ? st.cursor : new Date()) }) }, '+ Neuer Termin') : null,
      h('div', { class: 'sb-title' },
        h('span', null, 'Unterkalender'),
        subs.length > 1 ? h('button', { type: 'button', class: 'link-btn', onclick: () => setHidden(allShown ? subs.map(s => s.id) : []) }, allShown ? 'keine' : 'alle') : null),
      h('ul', { class: 'subcal-list' }, subs.map(s => {
        const l = ctx.level(s.id);
        return h('li', null, h('label', { class: 'subcal' },
          h('input', { type: 'checkbox', checked: !st.hidden.has(s.id), onchange: e => toggleSub(s.id, e.target.checked) }),
          h('span', { class: 'swatch', style: { background: s.color } }),
          h('span', { class: 'subcal-name' }, s.name),
          PERM_ICON[l] ? h('span', { class: 'perm', title: LEVEL_LABELS[l] }, PERM_ICON[l]) : null));
      })),
      subs.length ? null : h('p', { class: 'muted' }, 'Keine Unterkalender freigegeben.'),
      ctx.isAdmin ? h('button', { type: 'button', class: 'link-btn', onclick: () => openSettings(ctx, 'subcals') }, 'Unterkalender verwalten') : null,
      ctx.isAdmin ? h('button', { type: 'button', class: 'link-btn', onclick: () => openSettings(ctx, 'links') }, 'Zugriffslinks verwalten') : null,
      b.mode === 'demo' ? h('p', { class: 'demo-note' }, 'Demo-Modus: Daten liegen nur in diesem Browser.') : null);
  }

  function renderMain() {
    titleEl.textContent = st.results ? `Suche: „${st.search}“` : viewTitle(st.view, st.cursor);
    viewBtns.forEach(x => x.classList.toggle('active', x.dataset.v === st.view && !st.results));
    calNameEl.textContent = st.cal?.name || '';
    document.title = st.cal?.name ? `${st.cal.name} – Kalender` : 'Kalender';
    if (st.results) renderResults(ctx, main, st.results);
    else renderView(ctx, st.view, main);
  }

  // Mehrere Änderungen kurz hintereinander werden zu einem Neuaufbau zusammengefasst.
  // setTimeout statt requestAnimationFrame, damit auch Hintergrund-Tabs (Info-Monitore) aktuell bleiben.
  let timer = 0;
  function scheduleRender() {
    if (timer || !st.cal) return;
    timer = setTimeout(() => { timer = 0; renderSidebar(); renderMain(); }, 0);
  }

  function changed() {
    syncEventSubs();
    syncUrl();
    shell.classList.remove('sb-open');
    scheduleRender();
  }

  function step(dir) {
    st.cursor = stepCursor(st.view, st.cursor, dir);
    clearSearch(false);
    changed();
  }

  // Ansicht und Datum stehen in der Adresse, damit Neuladen und Lesezeichen funktionieren.
  function syncUrl() {
    const [path, qs = ''] = location.hash.split('?');
    const p = new URLSearchParams(qs);
    p.set('view', st.view);
    p.set('date', ymd(st.cursor));
    history.replaceState(null, '', `${path}?${p}`);
  }

  function setHidden(ids) {
    st.hidden = new Set(ids);
    store.set(`kd-hidden-${calId}`, [...st.hidden]);
    scheduleRender();
  }
  function toggleSub(id, visible) {
    const ids = new Set(st.hidden);
    visible ? ids.delete(id) : ids.add(id);
    setHidden([...ids]);
  }

  // ---------- Suche ----------

  async function runSearch() {
    const text = searchInput.value.trim();
    if (!text) return clearSearch();
    st.search = text;
    try {
      st.results = await searchEvents(ctx, text);
    } catch (e) {
      return toast(errorText(e), 'error');
    }
    shell.classList.remove('sb-open');
    scheduleRender();
  }
  function clearSearch(render = true) {
    if (!st.results && !st.search) return;
    st.results = null;
    st.search = '';
    searchInput.value = '';
    if (render) scheduleRender();
  }

  // ---------- Verschieben per Drag & Drop ----------

  async function moveTo(occ, newStart, newSub = occ.ev.subcalId) {
    const ev = occ.ev;
    const days = diffDays(occ.start, newStart);
    const minutes = ev.allDay ? 0 : minutesOfDay(newStart) - minutesOfDay(occ.start);
    if (!days && !minutes && newSub === ev.subcalId) return;
    if (newSub !== ev.subcalId && !ctx.canCreateIn(newSub)) return toast('Keine Berechtigung für diesen Unterkalender.', 'error');
    const shift = d => { const r = addDays(d, days); r.setMinutes(r.getMinutes() + minutes); return r; };
    const fmt = d => (ev.allDay ? ymd(d) : ymdhm(d));

    let scope = 'all';
    if (ev.rrule) {
      scope = await choiceDialog('Serientermin verschieben', 'Welche Termine sollen verschoben werden?', [
        { label: 'Nur diesen Termin', value: 'one' },
        { label: 'Alle Termine der Serie', value: 'all' },
      ]);
      if (!scope) return;
    }
    try {
      if (scope === 'one') {
        const single = { ...ev, rrule: null, exdates: [], createdAt: null, start: fmt(shift(occ.start)), end: fmt(shift(ev.allDay ? addDays(occ.end, -1) : occ.end)) };
        await b.batch([
          ...eventOps(calId, ev.subcalId, ev.id, { ...ev, exdates: [...(ev.exdates || []), occ.date] }, ev.createdBy),
          ...eventOps(calId, newSub, b.newId(), single, user.uid),
        ]);
      } else {
        const data = { ...ev, start: fmt(shift(parse(ev.start))), end: fmt(shift(parse(ev.end))) };
        if (ev.rrule?.byday?.length && days % 7) data.rrule = { ...ev.rrule, byday: ev.rrule.byday.map(d => (((d + days) % 7) + 7) % 7) };
        if (ev.exdates?.length) data.exdates = ev.exdates.map(x => ymd(addDays(parse(x), days)));
        if (newSub !== ev.subcalId) await moveEvent(calId, ev.subcalId, newSub, ev.id, data, ev.createdBy);
        else await saveEvent(calId, ev.subcalId, ev.id, data, ev.createdBy);
      }
    } catch (e) {
      toast(`Verschieben fehlgeschlagen: ${errorText(e)}`, 'error');
    }
  }

  // ---------- Live-Daten ----------

  // Abonniert pro Unterkalender alle Termine ab Beginn des sichtbaren Zeitraums (mit Puffer).
  function syncEventSubs() {
    if (!st.view) return;
    const { from } = viewRange(st.view, st.cursor);
    if (!st.subFrom || ymd(from) < st.subFrom || diffDays(parse(st.subFrom), from) > 120) {
      st.subs.forEach(u => u());
      st.subs.clear();
      st.subFrom = ymd(addDays(from, -31));
    }
    const wanted = new Map();
    for (const s of st.subcals) {
      const l = ctx.level(s.id);
      if (l >= 1) wanted.set(`${s.id}:${l === 1 ? 'busy' : 'full'}`, { s: s.id, busy: l === 1 });
    }
    for (const [k, unsub] of st.subs) {
      if (!wanted.has(k)) { unsub(); st.subs.delete(k); st.events.delete(k.split(':')[0]); }
    }
    for (const [k, w] of wanted) {
      if (st.subs.has(k)) continue;
      st.subs.set(k, watchEvents(calId, w.s, st.subFrom, w.busy, rows => {
        st.events.set(w.s, rows);
        scheduleRender();
      }, e => toast(`Termine konnten nicht geladen werden: ${errorText(e)}`, 'error')));
    }
  }

  const fatal = e => app.showError('Kein Zugriff', errorText(e));
  const unsubCal = watchCalendar(calId, cal => {
    if (!cal) return app.showError('Kalender nicht gefunden', 'Dieser Kalender wurde gelöscht.');
    const first = !st.cal;
    st.cal = cal;
    if (!st.view) st.view = VIEW_KEYS.includes(query.get('view')) ? query.get('view') : cal.settings?.defaultView || 'month';
    if (first) changed(); else scheduleRender();
  }, fatal);
  const unsubSubs = watchSubcals(calId, rows => {
    st.subcals = rows;
    syncEventSubs();
    scheduleRender();
  }, fatal);

  onCleanup(() => {
    unsubCal();
    unsubSubs();
    st.subs.forEach(u => u());
    clearTimeout(timer);
    document.body.classList.remove('embed');
  });
}
