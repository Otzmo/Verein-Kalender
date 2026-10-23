// Einstieg: Anmeldung, Kalenderübersicht und das Öffnen von Zugriffslinks.
import { h, btn, field, toast, store, promptDialog, closeAllModals, errorText } from './ui.js';
import { backend as b, createCalendar, listMyCalendars, getCalendar, getLink, watchLink, joinCalendar, passwordAccessId } from './data.js';
import { startCalendar } from './calendar.js';
import { renderBooking } from './booking.js';

const root = document.getElementById('app');
let user = null;
let cleanup = [];
let token = 0;
let linkTheme = null;

// ---------- Darstellung hell/dunkel ----------

function applyTheme() {
  const pref = store.get('kd-theme');
  const mode = pref || (linkTheme && linkTheme !== 'auto' ? linkTheme : null);
  if (mode) document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
}
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
function toggleTheme() {
  store.set('kd-theme', isDark() ? 'light' : 'dark');
  applyTheme();
}

const app = {
  isDark,
  toggleTheme,
  signOut: async () => { await b.signOut(); location.hash = '#/'; },
  showError: (title, text) => showError(title, text),
};

// ---------- Routing ----------

function parseHash() {
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

async function route() {
  const my = ++token;
  const current = () => my === token;
  cleanup.forEach(fn => fn());
  cleanup = [];
  closeAllModals();
  linkTheme = null;
  applyTheme();
  const onCleanup = fn => cleanup.push(fn);
  const { parts, query } = parseHash();
  try {
    if (parts[0] === 'l' && parts[1]) await openLink(decodeURIComponent(parts[1]), query, current, onCleanup);
    else if (parts[0] === 'c' && parts[1]) await openOwnCalendar(parts[1], query, current, onCleanup);
    else if (!user || user.anonymous) renderLogin();
    else await renderDashboard(current);
  } catch (e) {
    console.error(e);
    if (current()) showError('Fehler', errorText(e));
  }
}

let lastUid;
b.onAuth(u => {
  user = u;
  if (u?.uid === lastUid && lastUid !== undefined) return;
  lastUid = u?.uid ?? null;
  route();
});
window.addEventListener('hashchange', route);

// ---------- Seitenbausteine ----------

function page(...children) {
  root.replaceChildren(h('div', { class: 'page' }, ...children));
}

function showError(title, text) {
  page(h('div', { class: 'card narrow center-text' },
    h('h1', null, title),
    h('p', { class: 'muted' }, text),
    h('a', { class: 'btn', href: '#/' }, 'Zur Startseite')));
}

const demoBanner = () => (b.mode === 'demo'
  ? h('div', { class: 'demo-banner' }, 'Demo-Modus: Es ist noch kein Firebase-Projekt eingetragen. Alle Daten bleiben nur in diesem Browser.')
  : null);

function recentLinks() {
  const list = store.get('kd-recent') || [];
  if (!list.length) return null;
  return h('section', { class: 'card' },
    h('h2', null, 'Zuletzt über Link geöffnet'),
    h('ul', { class: 'cal-list' }, list.map(r => h('li', null, h('a', { href: `#/l/${r.key}` }, r.name || r.key)))));
}

function rememberLink(key, name) {
  const list = (store.get('kd-recent') || []).filter(r => r.key !== key);
  list.unshift({ key, name, at: Date.now() });
  store.set('kd-recent', list.slice(0, 10));
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.',
  'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
  'auth/user-not-found': 'Zu dieser E-Mail gibt es kein Konto.',
  'auth/email-already-in-use': 'Diese E-Mail ist bereits registriert.',
  'auth/weak-password': 'Das Passwort braucht mindestens 6 Zeichen.',
  'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte später erneut probieren.',
  'auth/network-request-failed': 'Keine Verbindung zum Server.',
  'auth/operation-not-allowed': 'Diese Anmeldeart ist im Firebase-Projekt nicht aktiviert.',
  'auth/admin-restricted-operation': 'Die anonyme Anmeldung ist im Firebase-Projekt nicht aktiviert.',
};
const authError = e => AUTH_ERRORS[e?.code] || errorText(e);

// ---------- Anmeldung ----------

function renderLogin(mode = 'login') {
  const email = h('input', { type: 'email', required: true, autocomplete: 'email' });
  const password = h('input', { type: 'password', required: true, minlength: 6, autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const password2 = h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' });
  const submit = h('button', { class: 'btn primary block' }, mode === 'login' ? 'Anmelden' : 'Konto erstellen');
  const form = h('form', {
    class: 'stack',
    onsubmit: async e => {
      e.preventDefault();
      if (mode === 'register' && password.value !== password2.value) return toast('Die Passwörter stimmen nicht überein.', 'error');
      submit.disabled = true;
      try {
        if (mode === 'login') await b.signIn(email.value, password.value);
        else await b.signUp(email.value, password.value);
      } catch (err) {
        toast(authError(err), 'error');
        submit.disabled = false;
      }
    },
  },
  field('E-Mail', email),
  field('Passwort', password),
  mode === 'register' ? field('Passwort wiederholen', password2) : null,
  submit);

  page(demoBanner(),
    h('div', { class: 'card narrow' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, '31'), h('span', null, 'Kalender')),
      h('p', { class: 'muted' }, 'Gemeinsame Online-Kalender für Teams, Vereine und Familien. Andere greifen über Links zu, ganz ohne Konto.'),
      h('div', { class: 'tabs' },
        h('button', { type: 'button', class: `tab${mode === 'login' ? ' active' : ''}`, onclick: () => renderLogin('login') }, 'Anmelden'),
        h('button', { type: 'button', class: `tab${mode === 'register' ? ' active' : ''}`, onclick: () => renderLogin('register') }, 'Registrieren')),
      form,
      mode === 'login' ? h('button', {
        type: 'button', class: 'link-btn',
        onclick: async () => {
          const mail = email.value || await promptDialog('Passwort vergessen', 'E-Mail-Adresse', { type: 'email', ok: 'Link senden' });
          if (!mail) return;
          try {
            await b.resetPassword(mail);
            toast(b.mode === 'demo' ? 'Im Demo-Modus werden keine E-Mails verschickt.' : 'E-Mail zum Zurücksetzen wurde verschickt.');
          } catch (err) { toast(authError(err), 'error'); }
        },
      }, 'Passwort vergessen?') : null),
    recentLinks());
}

// ---------- Übersicht ----------

async function renderDashboard(current) {
  const cals = await listMyCalendars(user.uid);
  if (!current()) return;
  cals.sort((x, y) => x.name.localeCompare(y.name, 'de'));
  page(demoBanner(),
    h('header', { class: 'dash-head' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, '31'), h('span', null, 'Kalender')),
      h('div', { class: 'row gap' },
        h('span', { class: 'muted small' }, user.email),
        h('button', { type: 'button', class: 'icon-btn', title: 'Hell/Dunkel', 'aria-label': 'Hell oder dunkel', onclick: toggleTheme }, '◐'),
        btn('Abmelden', app.signOut))),
    h('section', { class: 'card' },
      h('div', { class: 'row space' },
        h('h2', null, 'Meine Kalender'),
        btn('+ Neuer Kalender', async () => {
          const name = await promptDialog('Neuer Kalender', 'Name', { ok: 'Erstellen' });
          if (!name) return;
          try {
            const id = await createCalendar(name, user.uid);
            location.hash = `#/c/${id}`;
          } catch (e) { toast(errorText(e), 'error'); }
        }, 'primary')),
      cals.length
        ? h('ul', { class: 'cal-list' }, cals.map(c => h('li', null, h('a', { href: `#/c/${c.id}` }, c.name))))
        : h('p', { class: 'muted' }, 'Du hast noch keinen Kalender. Lege jetzt deinen ersten an.')),
    recentLinks());
}

// ---------- Kalender öffnen ----------

async function openOwnCalendar(calId, query, current, onCleanup) {
  if (!user || user.anonymous) { location.hash = '#/'; return; }
  const cal = await getCalendar(calId);
  if (!current()) return;
  if (!cal || cal.ownerUid !== user.uid) return showError('Kein Zugriff', 'Diesen Kalender gibt es nicht oder er gehört zu einem anderen Konto.');
  startCalendar({ root, calId, access: { owner: true, admin: true }, user, query, onCleanup, app });
}

function askLinkPassword(retry) {
  return new Promise(resolve => {
    const input = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
    page(h('div', { class: 'card narrow' },
      h('h1', null, 'Passwort erforderlich'),
      h('p', { class: 'muted' }, 'Dieser Kalender ist mit einem Passwort geschützt.'),
      retry ? h('p', { class: 'error' }, 'Das Passwort ist falsch.') : null,
      h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); if (input.value) resolve(input.value); } },
        field('Passwort', input), h('button', { class: 'btn primary block' }, 'Öffnen'))));
    input.focus();
  });
}

async function openLink(key, query, current, onCleanup) {
  if (!user) {
    root.replaceChildren(h('div', { class: 'loading' }, 'Wird geöffnet …'));
    try { await b.signInAnon(); } catch (e) { showError('Anmeldung fehlgeschlagen', authError(e)); }
    return; // onAuth ruft route() erneut auf
  }
  const stub = await getLink(key);
  if (!current()) return;
  if (!stub) return showError('Link ungültig', 'Diesen Zugriffslink gibt es nicht (mehr).');

  let link = stub, accessId = key;
  if (stub.passwordRequired) {
    accessId = store.get(`kd-access-${key}`);
    link = accessId ? await getLink(accessId) : null;
    let retry = false;
    while (!link) {
      const pw = await askLinkPassword(retry);
      if (!current()) return;
      accessId = await passwordAccessId(key, pw);
      link = await getLink(accessId);
      retry = true;
    }
    store.set(`kd-access-${key}`, accessId);
  }

  await joinCalendar(link.calendarId, user.uid, accessId);
  if (!current()) return;
  linkTheme = link.darkMode;
  applyTheme();

  // Ändert oder löscht der Administrator den Link, wird die Seite neu aufgebaut.
  let first = true;
  onCleanup(watchLink(accessId, () => { if (first) { first = false; return; } route(); }, () => {}));

  const cal = await getCalendar(link.calendarId);
  if (!current()) return;
  rememberLink(key, link.type === 'booking' ? `${link.name} (Buchung)` : cal?.name);

  if (link.type === 'booking') return renderBooking(root, { link, user, onCleanup, app });
  startCalendar({
    root,
    calId: link.calendarId,
    access: { owner: false, admin: !!link.admin, perms: link.perms || {}, defaultLevel: link.defaultLevel ?? 0 },
    user, query, onCleanup, app,
  });
}
