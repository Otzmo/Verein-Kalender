// Einstellungen: Allgemein, Unterkalender und Zugriffslinks (inkl. Buchungslinks).
import { h, fill, modal, btn, field, select, toast, confirmDialog, copyText, errorText } from './ui.js';
import {
  updateCalendar, deleteCalendar, watchSubcals, addSubcal, updateSubcal, deleteSubcal,
  listLinks, saveLink, deleteLink, getLink, randomKey, LEVEL_LABELS, COLORS,
} from './data.js';
import { HOLIDAY_REGIONS } from './holidays.js';
import { VIEWS } from './views.js';
import { WEEKDAYS } from './dates.js';

const LEVEL_OPTIONS = LEVEL_LABELS.map((label, i) => [String(i), label]);
const THEMES = [['auto', 'Wie Gerät'], ['light', 'Hell'], ['dark', 'Dunkel']];

export const linkUrl = (key, extra = '') => `${location.origin}${location.pathname}#/l/${key}${extra}`;

export function openSettings(ctx, tab = 'general') {
  const tabs = [['general', 'Allgemein'], ['subcals', 'Unterkalender'], ['links', 'Zugriffslinks']];
  const content = h('div', { class: 'settings-content' });
  const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { k }, onclick: () => show(k) }, label)));
  let unsub = null;
  modal({ title: 'Einstellungen', body: h('div', null, tabBar, content), wide: true, onClose: () => unsub?.() });

  function show(k) {
    unsub?.();
    unsub = null;
    tabBar.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.k === k);
      t.setAttribute('aria-selected', String(t.dataset.k === k));
    });
    if (k === 'general') general(ctx, content);
    else if (k === 'subcals') unsub = subcalendars(ctx, content);
    else links(ctx, content);
  }
  show(tab);
}

// ---------- Allgemein ----------

function general(ctx, root) {
  const cal = ctx.st.cal;
  const name = h('input', { type: 'text', value: cal.name, maxlength: 100, required: true });
  const holidays = select(HOLIDAY_REGIONS, cal.settings?.holidays || 'none');
  const view = select(VIEWS, cal.settings?.defaultView || 'month');
  const form = h('form', {
    class: 'stack',
    onsubmit: async e => {
      e.preventDefault();
      if (!name.value.trim()) return;
      try {
        await updateCalendar(ctx.calId, { name: name.value.trim(), settings: { ...cal.settings, holidays: holidays.value, defaultView: view.value } });
        toast('Gespeichert');
      } catch (err) { toast(errorText(err), 'error'); }
    },
  },
  field('Name des Kalenders', name),
  field('Feiertage', holidays),
  field('Standardansicht', view, 'Gilt für alle, die den Kalender ohne eigene Auswahl öffnen.'),
  h('div', null, h('button', { class: 'btn primary' }, 'Speichern')));

  fill(root, form, ctx.access.owner ? h('div', { class: 'danger-zone' },
    h('h3', null, 'Kalender löschen'),
    h('p', { class: 'muted' }, 'Löscht den Kalender mit allen Unterkalendern, Terminen und Zugriffslinks. Das lässt sich nicht rückgängig machen.'),
    btn('Kalender endgültig löschen', async () => {
      if (!await confirmDialog(`„${cal.name}“ mit allen Terminen endgültig löschen?`, { title: 'Kalender löschen', ok: 'Endgültig löschen', danger: true })) return;
      try {
        await deleteCalendar(ctx.calId, ctx.uid);
        toast('Kalender gelöscht');
        location.hash = '#/';
      } catch (err) { toast(errorText(err), 'error'); }
    }, 'danger')) : null);
}

// ---------- Unterkalender ----------

function subcalendars(ctx, root) {
  const fail = e => toast(errorText(e), 'error');
  const list = h('ul', { class: 'edit-list' });
  let rows = [];

  const newName = h('input', { type: 'text', placeholder: 'Name des neuen Unterkalenders', maxlength: 60, required: true });
  const addForm = h('form', {
    class: 'inline-form',
    onsubmit: e => {
      e.preventDefault();
      const name = newName.value.trim();
      if (!name) return;
      const used = new Set(rows.map(r => r.color));
      addSubcal(ctx.calId, { name, color: COLORS.find(c => !used.has(c)) || COLORS[rows.length % COLORS.length], order: rows.length ? Math.max(...rows.map(r => r.order ?? 0)) + 1 : 0 })
        .then(() => { newName.value = ''; }).catch(fail);
    },
  }, newName, h('button', { class: 'btn primary' }, 'Hinzufügen'));

  const swap = (i, j) => {
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    Promise.all(next.map((s, order) => (s.order === order ? null : updateSubcal(ctx.calId, s.id, { order })))).catch(fail);
  };

  const unsub = watchSubcals(ctx.calId, subs => {
    rows = subs;
    list.replaceChildren(...subs.map((s, i) => h('li', { class: 'edit-row' },
      h('input', { type: 'color', value: s.color, 'aria-label': 'Farbe', onchange: e => updateSubcal(ctx.calId, s.id, { color: e.target.value }).catch(fail) }),
      h('input', { type: 'text', value: s.name, maxlength: 60, 'aria-label': 'Name', onchange: e => e.target.value.trim() && updateSubcal(ctx.calId, s.id, { name: e.target.value.trim() }).catch(fail) }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => swap(i, i - 1) }, '↑'),
      h('button', { type: 'button', class: 'icon-btn', title: 'Nach unten', 'aria-label': 'Nach unten', disabled: i === subs.length - 1, onclick: () => swap(i, i + 1) }, '↓'),
      h('button', {
        type: 'button', class: 'icon-btn danger', title: 'Löschen', 'aria-label': 'Löschen',
        onclick: async () => {
          if (subs.length === 1) return toast('Der letzte Unterkalender kann nicht gelöscht werden.', 'error');
          if (!await confirmDialog(`„${s.name}“ und alle Termine darin löschen?`, { title: 'Unterkalender löschen', ok: 'Löschen', danger: true })) return;
          deleteSubcal(ctx.calId, s.id).then(() => toast('Unterkalender gelöscht')).catch(fail);
        },
      }, '🗑'))));
  }, fail);

  root.replaceChildren(list, addForm);
  return unsub;
}

// ---------- Zugriffslinks ----------

async function links(ctx, root) {
  root.replaceChildren(h('p', { class: 'muted' }, 'Wird geladen …'));
  let items;
  try {
    items = await listLinks(ctx.calId, ctx.access.owner ? ctx.uid : null);
  } catch (e) {
    root.replaceChildren(h('p', { class: 'error' }, errorText(e)));
    return;
  }
  const reload = () => links(ctx, root);
  const subName = id => ctx.subcal(id)?.name || '–';

  const describe = l => {
    if (l.type === 'booking') return `Buchung: ${l.booking?.duration || '?'} Min. in „${subName(l.bookTarget)}“`;
    if (l.admin) return 'Administrator: alle Rechte und Einstellungen';
    const parts = ctx.st.subcals.map(s => `${s.name}: ${LEVEL_LABELS[l.perms?.[s.id] ?? l.defaultLevel ?? 0]}`);
    return parts.join(' · ');
  };

  root.replaceChildren(
    h('p', { class: 'muted' }, 'Über Zugriffslinks öffnen andere den Kalender ohne Konto. Pro Link legst du fest, was in welchem Unterkalender erlaubt ist.'),
    h('div', { class: 'row gap' },
      btn('+ Neuer Link', () => editLink(ctx, null, 'calendar', reload), 'primary'),
      btn('+ Neuer Buchungslink', () => editLink(ctx, null, 'booking', reload))),
    items.length ? h('ul', { class: 'link-list' }, items.map(l => h('li', { class: 'link-item' },
      h('div', { class: 'link-head' },
        h('strong', null, l.name || '(ohne Namen)'),
        l.type === 'booking' ? h('span', { class: 'badge' }, 'Buchung') : null,
        l.admin ? h('span', { class: 'badge accent' }, 'Administrator') : null,
        l.passwordProtected ? h('span', { class: 'badge' }, 'Passwort') : null),
      h('div', { class: 'muted small' }, describe(l)),
      h('div', { class: 'link-url' },
        h('input', { type: 'text', readonly: true, value: linkUrl(l.key), 'aria-label': 'Link', onfocus: e => e.target.select() }),
        btn('Kopieren', () => copyText(linkUrl(l.key))),
        btn('Öffnen', () => window.open(linkUrl(l.key), '_blank', 'noopener'))),
      h('div', { class: 'row gap' },
        btn('Bearbeiten', () => editLink(ctx, l, l.type || 'calendar', reload)),
        l.type === 'booking' ? null : btn('Einbetten', () => showEmbed(l)),
        btn('Löschen', async () => {
          if (!await confirmDialog(`Link „${l.name}“ löschen? Wer ihn benutzt, verliert sofort den Zugriff.`, { title: 'Link löschen', ok: 'Löschen', danger: true })) return;
          deleteLink(l).then(() => { toast('Link gelöscht'); reload(); }).catch(e => toast(errorText(e), 'error'));
        }, 'danger'))))) : h('p', { class: 'empty' }, 'Noch keine Zugriffslinks.'));
}

function showEmbed(l) {
  const code = `<iframe src="${linkUrl(l.key, '?embed=1')}" style="width:100%;height:700px;border:0" title="Kalender"></iframe>`;
  const m = modal({
    title: 'In Webseite einbetten',
    body: h('div', { class: 'stack' },
      h('p', null, 'Füge diesen Code in deine Webseite ein. Für Info-Monitore kannst du die Adresse aus dem Code direkt im Vollbild öffnen; Änderungen erscheinen automatisch.'),
      h('textarea', { rows: 4, readonly: true, value: code, onfocus: e => e.target.select() }),
      h('p', { class: 'hint' }, 'Mit &view=week, &view=list usw. am Ende der Adresse legst du die Ansicht fest.')),
    actions: [btn('Schließen', () => m.close()), btn('Code kopieren', () => copyText(code), 'primary')],
  });
}

function editLink(ctx, link, type, onSaved) {
  const subs = ctx.st.subcals;
  const isBooking = type === 'booking';
  const bk = link?.booking || {};
  const f = {
    name: h('input', { type: 'text', value: link?.name || '', maxlength: 80, required: true, placeholder: isBooking ? 'z. B. Beratungsgespräch' : 'z. B. Mitglieder' }),
    key: h('input', { type: 'text', placeholder: 'leer = zufällig (empfohlen)', maxlength: 40, pattern: '[a-z0-9][a-z0-9-]{3,39}' }),
    admin: h('input', { type: 'checkbox', checked: !!link?.admin }),
    defaultLevel: select(LEVEL_OPTIONS, String(link?.defaultLevel ?? 0)),
    perms: Object.fromEntries(subs.map(s => [s.id, select(LEVEL_OPTIONS, String(link?.perms?.[s.id] ?? link?.defaultLevel ?? 2))])),
    pwMode: select(link?.passwordProtected ? [['keep', 'Beibehalten'], ['change', 'Ändern'], ['remove', 'Entfernen']] : [['none', 'Kein Passwort'], ['change', 'Passwort festlegen']], link?.passwordProtected ? 'keep' : 'none'),
    password: h('input', { type: 'password', placeholder: 'Neues Passwort', minlength: 4, autocomplete: 'new-password' }),
    darkMode: select(THEMES, link?.darkMode || 'auto'),
    // Buchung
    description: h('textarea', { rows: 2, maxlength: 1000, placeholder: 'Text, den Buchende sehen' }, bk.description || ''),
    duration: select([15, 20, 30, 45, 60, 90, 120, 180].map(n => [String(n), `${n} Minuten`]), String(bk.duration || 30)),
    target: select(subs.map(s => [s.id, s.name]), link?.bookTarget || subs[0]?.id),
    avail: Object.fromEntries(subs.map(s => [s.id, h('input', { type: 'checkbox', checked: link ? (bk.availability || []).includes(s.id) : true })])),
    hours: WEEKDAYS.map((w, i) => {
      const cur = link ? bk.hours?.[i] : i < 5 ? { from: '09:00', to: '17:00' } : null;
      return { on: h('input', { type: 'checkbox', checked: !!cur }), from: h('input', { type: 'time', value: cur?.from || '09:00', step: 900 }), to: h('input', { type: 'time', value: cur?.to || '17:00', step: 900 }) };
    }),
    notice: h('input', { type: 'number', min: 0, max: 720, value: bk.notice ?? 24 }),
    daysAhead: h('input', { type: 'number', min: 1, max: 730, value: bk.daysAhead ?? 60 }),
  };

  const permTable = h('table', { class: 'perm-table' },
    h('tbody', null, subs.map(s => h('tr', null,
      h('td', null, h('span', { class: 'swatch', style: { background: s.color } }), ` ${s.name}`),
      h('td', null, f.perms[s.id]))),
    h('tr', null, h('td', { class: 'muted' }, 'Neue Unterkalender'), h('td', null, f.defaultLevel))));
  const updatePerms = () => { permTable.hidden = f.admin.checked; };
  f.admin.addEventListener('change', updatePerms);
  updatePerms();
  const updatePw = () => { f.password.hidden = f.pwMode.value !== 'change'; };
  f.pwMode.addEventListener('change', updatePw);
  updatePw();

  const calendarFields = [
    h('label', { class: 'check' }, f.admin, ' Administrator (alle Rechte, darf Einstellungen und Links verwalten)'),
    h('div', null, h('div', { class: 'field-label' }, 'Rechte pro Unterkalender'), permTable,
      h('p', { class: 'hint' }, '„Ohne Details lesen“ zeigt nur belegte Zeiten. „Hinzufügen“ erlaubt neue Termine und das Bearbeiten eigener Termine.')),
  ];
  const bookingFields = [
    field('Beschreibung', f.description),
    h('div', { class: 'row' }, field('Dauer', f.duration), field('Termin eintragen in', f.target)),
    h('div', null, h('div', { class: 'field-label' }, 'Freie Zeiten prüfen in'),
      h('div', { class: 'checks' }, subs.map(s => h('label', { class: 'check' }, f.avail[s.id], ` ${s.name}`)))),
    h('div', null, h('div', { class: 'field-label' }, 'Buchbare Zeiten'),
      h('table', { class: 'hours-table' }, h('tbody', null, f.hours.map((x, i) => h('tr', null,
        h('td', null, h('label', { class: 'check' }, x.on, ` ${WEEKDAYS[i]}`)), h('td', null, x.from), h('td', null, '–'), h('td', null, x.to)))))),
    h('div', { class: 'row' }, field('Mindestvorlauf (Stunden)', f.notice), field('Buchbar bis (Tage im Voraus)', f.daysAhead)),
  ];

  const form = h('form', { class: 'stack', onsubmit: submit },
    field(isBooking ? 'Name des Angebots' : 'Bezeichnung', f.name, isBooking ? 'Wird Buchenden angezeigt und steht im Termintitel.' : 'Nur für dich, um Links zu unterscheiden.'),
    link ? null : field('Eigener Linkname', f.key, `Ergibt ${linkUrl('<name>')}. Kleinbuchstaben, Ziffern und Bindestrich, 4–40 Zeichen.`),
    isBooking ? bookingFields : calendarFields,
    h('div', { class: 'row' }, field('Passwort', f.pwMode), h('label', { class: 'field' }, h('span', { class: 'field-label' }, ' '), f.password)),
    isBooking ? null : field('Darstellung', f.darkMode),
    h('button', { type: 'submit', hidden: true }));

  const saveBtn = btn('Speichern', () => form.requestSubmit(), 'primary');
  const m = modal({
    title: link ? 'Link bearbeiten' : isBooking ? 'Neuer Buchungslink' : 'Neuer Zugriffslink',
    body: form, wide: true,
    actions: [btn('Abbrechen', () => m.close()), saveBtn],
  });

  async function submit(e) {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return toast('Bitte eine Bezeichnung angeben.', 'error');
    let key = link?.key;
    if (!key) {
      key = f.key.value.trim().toLowerCase();
      if (key && !/^[a-z0-9][a-z0-9-]{3,39}$/.test(key)) return toast('Der Linkname ist ungültig.', 'error');
      if (key && await getLink(key)) return toast('Dieser Linkname ist bereits vergeben.', 'error');
      key ||= randomKey();
    }
    let password;
    if (f.pwMode.value === 'change') {
      if (f.password.value.length < 4) return toast('Das Passwort braucht mindestens 4 Zeichen.', 'error');
      password = f.password.value;
    } else if (f.pwMode.value === 'remove' || (f.pwMode.value === 'none' && link?.passwordProtected)) password = '';

    const data = {
      calendarId: ctx.calId,
      ownerUid: ctx.st.cal.ownerUid,
      name,
      type,
      darkMode: f.darkMode.value,
      createdAt: link?.createdAt || Date.now(),
      admin: false,
      perms: {},
      defaultLevel: 0,
      bookTarget: '',
      booking: null,
    };
    if (isBooking) {
      const availability = subs.filter(s => f.avail[s.id].checked).map(s => s.id);
      if (!availability.includes(f.target.value)) availability.push(f.target.value);
      const hours = {};
      f.hours.forEach((x, i) => { if (x.on.checked && x.from.value < x.to.value) hours[i] = { from: x.from.value, to: x.to.value }; });
      if (!Object.keys(hours).length) return toast('Bitte mindestens einen Wochentag mit gültigen Zeiten wählen.', 'error');
      data.perms = Object.fromEntries(availability.map(id => [id, 1]));
      data.bookTarget = f.target.value;
      data.booking = {
        description: f.description.value.trim(),
        duration: Number(f.duration.value),
        availability, hours,
        notice: Math.max(0, Number(f.notice.value) || 0),
        daysAhead: Math.max(1, Number(f.daysAhead.value) || 60),
      };
    } else {
      data.admin = f.admin.checked;
      data.perms = Object.fromEntries(subs.map(s => [s.id, Number(f.perms[s.id].value)]));
      data.defaultLevel = Number(f.defaultLevel.value);
    }

    saveBtn.disabled = true;
    try {
      await saveLink({ key, data, password, previous: link });
      m.close();
      toast(link ? 'Link gespeichert' : 'Link erstellt');
      onSaved();
    } catch (err) {
      toast(errorText(err), 'error');
      saveBtn.disabled = false;
    }
  }
}
