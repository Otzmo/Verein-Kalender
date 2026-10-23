// Kleine DOM-Helfer, Dialoge und Hinweise.

const PROPS = new Set(['checked', 'disabled', 'selected', 'multiple', 'required', 'readOnly']);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (PROPS.has(k)) el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

// Wie replaceChildren, überspringt aber null/false und flacht Arrays ab.
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: `btn ${cls}`, onclick }, label);

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function select(options, value) {
  return h('select', null, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

// localStorage kann in privaten Fenstern fehlen oder werfen.
export const store = {
  get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

// ---------- Dialoge ----------

const stack = [];

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); }
});

export function modal({ title, body, actions = [], wide = false, onClose }) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    stack.splice(stack.indexOf(api), 1);
    onClose?.();
  };
  const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(); } },
    h('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', { class: 'dialog-head' },
        h('h2', null, title),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', title: 'Schließen', onclick: close }, '✕')),
      h('div', { class: 'dialog-body' }, body),
      actions.filter(Boolean).length ? h('footer', { class: 'dialog-foot' }, actions) : null));
  const api = { close, el: overlay };
  stack.push(api);
  document.body.append(overlay);
  setTimeout(() => overlay.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), select, textarea')?.focus(), 0);
  return api;
}

export function closeAllModals() {
  [...stack].reverse().forEach(m => m.close());
}

export function confirmDialog(message, { title = 'Bestätigen', ok = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    let result = false;
    const m = modal({
      title, body: h('p', null, message), onClose: () => resolve(result),
      actions: [btn('Abbrechen', () => m.close()), btn(ok, () => { result = true; m.close(); }, danger ? 'danger' : 'primary')],
    });
  });
}

export function choiceDialog(title, message, choices) {
  return new Promise(resolve => {
    let result = null;
    const m = modal({
      title, body: h('p', null, message), onClose: () => resolve(result),
      actions: [btn('Abbrechen', () => m.close()), ...choices.map(c => btn(c.label, () => { result = c.value; m.close(); }, c.danger ? 'danger' : 'primary'))],
    });
  });
}

export function promptDialog(title, label, { value = '', ok = 'OK', type = 'text' } = {}) {
  return new Promise(resolve => {
    let result = null;
    const input = h('input', { type, value, required: true });
    const form = h('form', { onsubmit: e => { e.preventDefault(); if (!input.value.trim()) return; result = input.value.trim(); m.close(); } },
      field(label, input), h('button', { type: 'submit', hidden: true }));
    const m = modal({
      title, body: form, onClose: () => resolve(result),
      actions: [btn('Abbrechen', () => m.close()), btn(ok, () => form.requestSubmit(), 'primary')],
    });
  });
}

// ---------- Menü ----------

let openPop = null;

function closePopover() {
  openPop?.remove();
  openPop = null;
  document.removeEventListener('mousedown', outside);
}

function outside(e) {
  if (openPop && !openPop.contains(e.target)) closePopover();
}

export function popover(anchor, items) {
  closePopover();
  const el = h('div', { class: 'popover', role: 'menu' }, items.filter(Boolean).map(it => it === '-'
    ? h('hr')
    : h('button', { type: 'button', class: 'menu-item', role: 'menuitem', onclick: () => { closePopover(); it.action(); } }, it.label)));
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 4 + window.scrollY}px`;
  el.style.left = `${Math.max(8, Math.min(r.right - el.offsetWidth, window.innerWidth - el.offsetWidth - 8))}px`;
  openPop = el;
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
}

// ---------- Sonstiges ----------

export function toast(message, kind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.classList.add('hide'), kind === 'error' ? 5000 : 2600);
  setTimeout(() => el.remove(), kind === 'error' ? 5400 : 3000);
}

export function download(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('In die Zwischenablage kopiert');
}

// Text mit anklickbaren Links.
export function linkify(text) {
  return text.split(/(https?:\/\/[^\s<]+)/g).map((part, i) => i % 2
    ? h('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part)
    : part);
}

export const slug = s => (s || 'termin').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'termin';

export function errorText(e) {
  if (e?.code === 'permission-denied') return 'Dafür fehlt die Berechtigung.';
  if (e?.code === 'unavailable') return 'Keine Verbindung zum Server.';
  return e?.message || String(e);
}
