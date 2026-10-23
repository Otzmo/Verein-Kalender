// Speicher-Backend auf Basis von Firebase Auth und Firestore.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, onSnapshot, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export function createFirebaseBackend(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  auth.languageCode = 'de';
  const db = getFirestore(app);

  const toUser = u => u && { uid: u.uid, email: u.email, anonymous: u.isAnonymous };
  const ref = path => doc(db, path);
  const q = (colPath, filters = []) => query(collection(db, colPath), ...filters.map(([f, op, v]) => where(f, op, v)));
  const row = s => (s.exists() ? { id: s.id, ...s.data() } : null);
  const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

  return {
    mode: 'firebase',
    user: () => toUser(auth.currentUser),
    onAuth: cb => onAuthStateChanged(auth, u => cb(toUser(u))),
    signUp: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signOut: () => signOut(auth),
    resetPassword: email => sendPasswordResetEmail(auth, email),
    signInAnon: () => signInAnonymously(auth),

    newId: () => doc(collection(db, 'ids')).id,
    get: async path => row(await getDoc(ref(path))),
    set: (path, data) => setDoc(ref(path), data),
    update: (path, patch) => updateDoc(ref(path), patch),
    del: path => deleteDoc(ref(path)),
    query: async (colPath, filters) => rows(await getDocs(q(colPath, filters))),
    watchDoc: (path, cb, err) => onSnapshot(ref(path), s => cb(row(s)), err),
    watchQuery: (colPath, filters, cb, err) => onSnapshot(q(colPath, filters), s => cb(rows(s)), err),

    // Firestore erlaubt höchstens 500 Schreibvorgänge pro Batch.
    async batch(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const wb = writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          if (o.type === 'set') wb.set(ref(o.path), o.data);
          else if (o.type === 'update') wb.update(ref(o.path), o.data);
          else wb.delete(ref(o.path));
        }
        await wb.commit();
      }
    },
  };
}
