// Demo-Backend: bildet die benutzten Firebase-Funktionen im localStorage nach.
// Berechtigungen werden hier nicht serverseitig geprüft, nur in der Oberfläche.

const DB_KEY = 'kd-demo-db';
const USERS_KEY = 'kd-demo-users';
const SESSION_KEY = 'kd-demo-session';

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Speicher voll oder gesperrt */ }
};
const clone = o => (o == null ? null : JSON.parse(JSON.stringify(o)));
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
const fail = (code, message) => Promise.reject(Object.assign(new Error(message), { code }));

export function createDemoBackend() {
  let db = read(DB_KEY, {});
  let session = read(SESSION_KEY, null);
  const authListeners = new Set();
  const dataListeners = new Set();

  const notify = () => setTimeout(() => dataListeners.forEach(l => l()), 0);
  const save = () => { write(DB_KEY, db); notify(); };
  const setSession = s => {
    session = s;
    write(SESSION_KEY, s);
    setTimeout(() => authListeners.forEach(cb => cb(clone(s))), 0);
  };

  window.addEventListener('storage', e => {
    if (e.key === DB_KEY) { db = read(DB_KEY, {}); notify(); }
  });

  const parentOf = path => path.slice(0, path.lastIndexOf('/'));
  const matches = (data, filters = []) => filters.every(([f, op, v]) => {
    const x = data[f];
    if (op === '==') return x === v;
    if (op === '>=') return x != null && x >= v;
    if (op === '<=') return x != null && x <= v;
    throw new Error(`Operator ${op} nicht unterstützt`);
  });
  const runQuery = (colPath, filters) => Object.entries(db)
    .filter(([p, d]) => parentOf(p) === colPath && matches(d, filters))
    .map(([p, d]) => ({ id: p.slice(colPath.length + 1), ...clone(d) }));

  const apply = o => {
    if (o.type === 'set') db[o.path] = clone(o.data);
    else if (o.type === 'update') {
      if (!db[o.path]) throw Object.assign(new Error('Dokument nicht gefunden'), { code: 'not-found' });
      db[o.path] = { ...db[o.path], ...clone(o.data) };
    } else delete db[o.path];
  };

  const watch = (compute, cb) => {
    let last;
    const run = () => {
      const value = compute();
      const json = JSON.stringify(value);
      if (json !== last) { last = json; cb(value); }
    };
    dataListeners.add(run);
    setTimeout(run, 0);
    return () => dataListeners.delete(run);
  };

  return {
    mode: 'demo',
    user: () => clone(session),
    onAuth(cb) {
      authListeners.add(cb);
      setTimeout(() => cb(clone(session)), 0);
      return () => authListeners.delete(cb);
    },
    async signUp(email, password) {
      const users = read(USERS_KEY, {});
      email = email.trim().toLowerCase();
      if (users[email]) return fail('auth/email-already-in-use', 'E-Mail bereits registriert');
      if (password.length < 6) return fail('auth/weak-password', 'Passwort zu kurz');
      users[email] = { password, uid: newId() };
      write(USERS_KEY, users);
      setSession({ uid: users[email].uid, email, anonymous: false });
    },
    async signIn(email, password) {
      const u = read(USERS_KEY, {})[email.trim().toLowerCase()];
      if (!u || u.password !== password) return fail('auth/invalid-credential', 'Falsche Zugangsdaten');
      setSession({ uid: u.uid, email: email.trim().toLowerCase(), anonymous: false });
    },
    async signOut() { setSession(null); },
    async resetPassword(email) {
      if (!read(USERS_KEY, {})[email.trim().toLowerCase()]) return fail('auth/user-not-found', 'Unbekannte E-Mail');
    },
    async signInAnon() { setSession({ uid: newId(), email: null, anonymous: true }); },

    newId,
    get: async path => (db[path] ? { id: path.split('/').pop(), ...clone(db[path]) } : null),
    set: async (path, data) => { apply({ type: 'set', path, data }); save(); },
    update: async (path, data) => { apply({ type: 'update', path, data }); save(); },
    del: async path => { apply({ type: 'delete', path }); save(); },
    query: async (colPath, filters) => runQuery(colPath, filters),
    watchDoc: (path, cb) => watch(() => (db[path] ? { id: path.split('/').pop(), ...clone(db[path]) } : null), cb),
    watchQuery: (colPath, filters, cb) => watch(() => runQuery(colPath, filters), cb),
    async batch(ops) {
      const backup = db;
      db = clone(db);
      try { ops.forEach(apply); } catch (e) { db = backup; throw e; }
      save();
    },
  };
}
