// Datenmodell und alle Lese-/Schreibzugriffe.
//
// calendars/{c}                                  Kalender (ownerUid, name, settings)
// calendars/{c}/members/{uid}                    über welchen Link ein Besucher beigetreten ist
// calendars/{c}/subcalendars/{s}                 Unterkalender (name, color, order)
// calendars/{c}/subcalendars/{s}/events/{e}      Termin mit allen Details
// calendars/{c}/subcalendars/{s}/busy/{e}        Kopie nur mit Zeiten für "ohne Details lesen"
// calendars/{c}/subcalendars/{s}/events/{e}/signups/{uid}, …/comments/{id}
// links/{key}                                    Zugriffslink (Rechte pro Unterkalender)
import b from './backend.js';
import { seriesEnd } from './dates.js';

export const backend = b;

export const LEVEL_LABELS = ['Kein Zugriff', 'Ohne Details lesen', 'Lesen', 'Hinzufügen', 'Bearbeiten'];
export const COLORS = ['#2f6fdf', '#1f9d74', '#d9822b', '#c23c5c', '#7b4fd6', '#0f8fa8', '#8a6d3b', '#5b6b7a', '#c99a00', '#d0479a', '#4d8f2a', '#a33a2a'];

const calPath = c => `calendars/${c}`;
const subPath = (c, s) => `calendars/${c}/subcalendars/${s}`;
const evCol = (c, s, busy) => `${subPath(c, s)}/${busy ? 'busy' : 'events'}`;

// ---------- Kalender ----------

export async function createCalendar(name, uid) {
  const c = b.newId();
  await b.set(calPath(c), { name, ownerUid: uid, createdAt: Date.now(), settings: { holidays: 'DE', defaultView: 'month' } });
  await b.set(subPath(c, b.newId()), { name: 'Allgemein', color: COLORS[0], order: 0 });
  return c;
}

export const getCalendar = c => b.get(calPath(c)).catch(() => null);
export const listMyCalendars = uid => b.query('calendars', [['ownerUid', '==', uid]]);
export const watchCalendar = (c, cb, err) => b.watchDoc(calPath(c), cb, err);
export const updateCalendar = (c, patch) => b.update(calPath(c), patch);

export async function deleteCalendar(c, uid) {
  for (const s of await b.query(`${calPath(c)}/subcalendars`)) await deleteSubcal(c, s.id);
  const links = await b.query('links', [['calendarId', '==', c], ['ownerUid', '==', uid]]);
  const members = await b.query(`${calPath(c)}/members`);
  await b.batch([
    ...links.map(l => ({ type: 'delete', path: `links/${l.id}` })),
    ...members.map(m => ({ type: 'delete', path: `${calPath(c)}/members/${m.id}` })),
  ]);
  await b.del(calPath(c));
}

// ---------- Unterkalender ----------

export function watchSubcals(c, cb, err) {
  return b.watchQuery(`${calPath(c)}/subcalendars`, [], rows => cb(rows.sort((x, y) => (x.order ?? 0) - (y.order ?? 0))), err);
}
export const addSubcal = (c, data) => b.set(subPath(c, b.newId()), data);
export const updateSubcal = (c, s, patch) => b.update(subPath(c, s), patch);

export async function deleteSubcal(c, s) {
  const [events, busy] = await Promise.all([b.query(evCol(c, s, false)), b.query(evCol(c, s, true))]);
  await b.batch([
    ...events.map(e => ({ type: 'delete', path: `${evCol(c, s, false)}/${e.id}` })),
    ...busy.map(e => ({ type: 'delete', path: `${evCol(c, s, true)}/${e.id}` })),
  ]);
  await b.del(subPath(c, s));
}

// ---------- Termine ----------

const tag = (rows, s, busy) => rows.map(r => ({ ...r, subcalId: s, busy }));

// Termine, die am Tag `fromYmd` oder später noch stattfinden.
export function watchEvents(c, s, fromYmd, busy, cb, err) {
  return b.watchQuery(evCol(c, s, busy), [['queryEnd', '>=', fromYmd]], rows => cb(tag(rows, s, busy)), err);
}
export const fetchEvents = async (c, s, busy) => tag(await b.query(evCol(c, s, busy)), s, busy);

function clean(d) {
  return {
    title: (d.title || '').slice(0, 300),
    start: d.start,
    end: d.end,
    allDay: !!d.allDay,
    rrule: d.rrule || null,
    exdates: d.exdates || [],
    location: d.location || '',
    who: d.who || '',
    notes: d.notes || '',
    signup: d.signup || null,
    createdAt: d.createdAt || Date.now(),
  };
}

// Schreibvorgänge für einen Termin samt "Belegt"-Kopie.
export function eventOps(c, s, id, data, createdBy) {
  const ev = { ...clean(data), createdBy, updatedAt: Date.now() };
  ev.queryEnd = seriesEnd(ev);
  const busy = { start: ev.start, end: ev.end, allDay: ev.allDay, rrule: ev.rrule, exdates: ev.exdates, queryEnd: ev.queryEnd, createdBy };
  return [
    { type: 'set', path: `${evCol(c, s, false)}/${id}`, data: ev },
    { type: 'set', path: `${evCol(c, s, true)}/${id}`, data: busy },
  ];
}

const deleteOps = (c, s, id) => [
  { type: 'delete', path: `${evCol(c, s, false)}/${id}` },
  { type: 'delete', path: `${evCol(c, s, true)}/${id}` },
];

export async function saveEvent(c, s, id, data, createdBy) {
  id ||= b.newId();
  await b.batch(eventOps(c, s, id, data, createdBy));
  return id;
}
export const deleteEvent = (c, s, id) => b.batch(deleteOps(c, s, id));
export const moveEvent = (c, from, to, id, data, createdBy) => b.batch([...deleteOps(c, from, id), ...eventOps(c, to, id, data, createdBy)]);

// ---------- Anmeldungen und Kommentare ----------

const listCol = (c, s, e, kind) => `${evCol(c, s, false)}/${e}/${kind}`;
export const watchList = (c, s, e, kind, cb, err) => b.watchQuery(listCol(c, s, e, kind), [], rows => cb(rows.sort((x, y) => x.at - y.at)), err);
export const setSignup = (c, s, e, uid, name) => b.set(`${listCol(c, s, e, 'signups')}/${uid}`, { name, at: Date.now() });
export const removeSignup = (c, s, e, uid) => b.del(`${listCol(c, s, e, 'signups')}/${uid}`);
export const addComment = (c, s, e, uid, name, text) => b.set(`${listCol(c, s, e, 'comments')}/${b.newId()}`, { uid, name, text, at: Date.now() });
export const removeComment = (c, s, e, id) => b.del(`${listCol(c, s, e, 'comments')}/${id}`);

// ---------- Zugriffslinks ----------

export function randomKey(len = 20) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(len)), x => alphabet[x % alphabet.length]).join('');
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join('');
}

export const passwordAccessId = (key, password) => sha256(`${key}:${password}`);
export const getLink = id => b.get(`links/${id}`).catch(() => null);
export const watchLink = (id, cb, err) => b.watchDoc(`links/${id}`, cb, err);
export const joinCalendar = (c, uid, accessId) => b.set(`${calPath(c)}/members/${uid}`, { accessId, at: Date.now() });

// Ein Link mit Passwort besteht aus einem Platzhalter unter dem Linkschlüssel und dem
// eigentlichen Link unter sha256(Schlüssel:Passwort). Ohne Passwort ist er nicht auffindbar.
export async function listLinks(c, ownerUid) {
  const filters = [['calendarId', '==', c]];
  if (ownerUid) filters.push(['ownerUid', '==', ownerUid]);
  const rows = await b.query('links', filters);
  const out = [];
  for (const r of rows) {
    if (r.stubId) continue;
    if (r.passwordRequired) {
      const real = rows.find(x => x.stubId === r.id);
      if (real) out.push({ ...real, key: r.id, realId: real.id, passwordProtected: true });
    } else out.push({ ...r, key: r.id, realId: r.id, passwordProtected: false });
  }
  return out.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
}

// password: undefined = unverändert, '' = entfernen, sonst neues Passwort.
export async function saveLink({ key, data, password, previous }) {
  const protectedNow = password === undefined ? !!previous?.passwordProtected : !!password;
  const realId = !protectedNow ? key : password === undefined ? previous.realId : await passwordAccessId(key, password);
  const ops = [];
  if (previous && previous.realId !== key && previous.realId !== realId) ops.push({ type: 'delete', path: `links/${previous.realId}` });
  if (protectedNow) {
    ops.push({ type: 'set', path: `links/${key}`, data: { calendarId: data.calendarId, ownerUid: data.ownerUid, name: data.name, type: data.type, passwordRequired: true, createdAt: data.createdAt } });
    ops.push({ type: 'set', path: `links/${realId}`, data: { ...data, stubId: key } });
  } else {
    ops.push({ type: 'set', path: `links/${key}`, data });
  }
  await b.batch(ops);
}

export async function deleteLink(link) {
  const ops = [{ type: 'delete', path: `links/${link.key}` }];
  if (link.realId !== link.key) ops.push({ type: 'delete', path: `links/${link.realId}` });
  await b.batch(ops);
}
