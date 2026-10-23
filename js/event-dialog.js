// Termin anzeigen, anlegen, bearbeiten und löschen.
import { h, fill, modal, btn, field, select, toast, confirmDialog, choiceDialog, store, download, linkify, slug, errorText } from './ui.js';
import {
  backend as b, saveEvent, moveEvent, eventOps, deleteEvent,
  watchList, setSignup, removeSignup, addComment, removeComment,
} from './data.js';
import { parse, ymd, hm, addDays, addMinutes, weekday, fmtOccurrence, rruleText, WEEKDAYS } from './dates.js';
import { toICS } from './ics.js';

const askName = () => store.get('kd-name') || '';

// ---------- Anzeige ----------

export function openEventDetail(ctx, occ) {
  const ev = occ.ev;
  const sc = ctx.subcal(ev.subcalId);
  const subLine = h('div', { class: 'detail-sub' }, h('span', { class: 'swatch', style: { background: sc?.color } }), sc?.name || '');

  if (ev.busy) {
    const m = modal({
      title: 'Belegt',
      body: h('div', { class: 'event-detail' }, subLine, h('div', { class: 'detail-when' }, fmtOccurrence(occ)),
        h('p', { class: 'muted' }, 'Für diesen Unterkalender sind keine Details freigegeben.')),
      actions: [btn('Schließen', () => m.close())],
    });
    return;
  }

  const canEdit = ctx.canEdit(ev);
  const level = ctx.level(ev.subcalId);
  const unsubs = [];
  const signupBox = h('div', { class: 'detail-section' });
  const commentBox = h('div', { class: 'detail-section' });

  const body = h('div', { class: 'event-detail' },
    subLine,
    h('div', { class: 'detail-when' }, fmtOccurrence(occ)),
    ev.rrule ? h('div', { class: 'muted' }, `↻ ${rruleText(ev.rrule)}`) : null,
    ev.location ? h('div', { class: 'detail-row' }, h('strong', null, 'Ort: '), ev.location) : null,
    ev.who ? h('div', { class: 'detail-row' }, h('strong', null, 'Wer: '), ev.who) : null,
    ev.notes ? h('div', { class: 'detail-notes' }, linkify(ev.notes)) : null,
    ev.signup?.enabled ? signupBox : null,
    commentBox);

  const m = modal({
    title: ev.title || '(ohne Titel)',
    body,
    onClose: () => unsubs.forEach(u => u()),
    actions: [
      btn('Als .ics', () => download(`${slug(ev.title)}.ics`, toICS([ev], ctx), 'text/calendar')),
      ctx.writableSubcals().length ? btn('Duplizieren', () => { m.close(); openEventEditor(ctx, { ev, occ, scope: 'one', copy: true }); }) : null,
      canEdit ? btn('Löschen', () => removeFlow(ctx, occ, m.close), 'danger') : null,
      canEdit ? btn('Bearbeiten', () => editFlow(ctx, occ, m), 'primary') : null,
    ],
  });

  const fail = e => toast(errorText(e), 'error');
  const args = [ctx.calId, ev.subcalId, ev.id];

  if (ev.signup?.enabled) {
    unsubs.push(watchList(...args, 'signups', rows => {
      const mine = rows.some(r => r.id === ctx.uid);
      const max = ev.signup.max;
      const nameIn = h('input', { type: 'text', placeholder: 'Dein Name', value: askName(), maxlength: 80, required: true });
      fill(signupBox,
        h('h3', null, `Anmeldungen (${rows.length}${max ? ` von ${max}` : ''})`),
        ev.rrule ? h('p', { class: 'hint' }, 'Die Anmeldung gilt für die ganze Serie.') : null,
        rows.length
          ? h('ul', { class: 'people' }, rows.map(r => h('li', null, r.name,
            r.id === ctx.uid || level >= 4 ? h('button', { type: 'button', class: 'icon-btn sm', title: 'Entfernen', 'aria-label': 'Entfernen', onclick: () => removeSignup(...args, r.id).catch(fail) }, '✕') : null)))
          : h('p', { class: 'muted' }, 'Noch keine Anmeldungen.'),
        mine ? null : max && rows.length >= max ? h('p', { class: 'muted' }, 'Ausgebucht.')
          : h('form', {
            class: 'inline-form',
            onsubmit: e => {
              e.preventDefault();
              const name = nameIn.value.trim();
              if (!name) return;
              store.set('kd-name', name);
              setSignup(...args, ctx.uid, name).catch(fail);
            },
          }, nameIn, h('button', { class: 'btn primary' }, 'Anmelden')));
    }, fail));
  }

  unsubs.push(watchList(...args, 'comments', rows => {
    const nameIn = h('input', { type: 'text', placeholder: 'Dein Name', value: askName(), maxlength: 80, required: true });
    const textIn = h('textarea', { rows: 2, placeholder: 'Kommentar schreiben …', maxlength: 2000, required: true });
    fill(commentBox,
      h('h3', null, `Kommentare${rows.length ? ` (${rows.length})` : ''}`),
      rows.map(r => h('div', { class: 'comment' },
        h('div', { class: 'comment-head' }, h('strong', null, r.name), h('span', { class: 'muted' }, ` · ${fmtStamp(r.at)}`),
          r.uid === ctx.uid || level >= 4 ? h('button', { type: 'button', class: 'icon-btn sm', title: 'Löschen', 'aria-label': 'Kommentar löschen', onclick: () => removeComment(...args, r.id).catch(fail) }, '✕') : null),
        h('div', { class: 'comment-text' }, linkify(r.text)))),
      h('form', {
        class: 'comment-form',
        onsubmit: e => {
          e.preventDefault();
          const name = nameIn.value.trim(), text = textIn.value.trim();
          if (!name || !text) return;
          store.set('kd-name', name);
          addComment(...args, ctx.uid, name, text).catch(fail);
        },
      }, nameIn, textIn, h('button', { class: 'btn' }, 'Kommentieren')));
  }, fail));
}

const fmtStamp = ms => { const d = new Date(ms); return `${ymd(d).split('-').reverse().join('.')} ${hm(d)}`; };

async function editFlow(ctx, occ, m) {
  let scope = 'all';
  if (occ.ev.rrule) {
    scope = await choiceDialog('Serientermin bearbeiten', 'Was möchtest du bearbeiten?', [
      { label: 'Nur diesen Termin', value: 'one' },
      { label: 'Alle Termine der Serie', value: 'all' },
    ]);
    if (!scope) return;
  }
  m.close();
  openEventEditor(ctx, { ev: occ.ev, occ, scope });
}

async function removeFlow(ctx, occ, close) {
  const ev = occ.ev;
  try {
    if (ev.rrule) {
      const scope = await choiceDialog('Serientermin löschen', 'Welche Termine sollen gelöscht werden?', [
        { label: 'Nur diesen Termin', value: 'one' },
        { label: 'Alle Termine der Serie', value: 'all', danger: true },
      ]);
      if (!scope) return;
      if (scope === 'one') await saveEvent(ctx.calId, ev.subcalId, ev.id, { ...ev, exdates: [...(ev.exdates || []), occ.date] }, ev.createdBy);
      else await deleteEvent(ctx.calId, ev.subcalId, ev.id);
    } else {
      if (!await confirmDialog(`„${ev.title || '(ohne Titel)'}“ wirklich löschen?`, { title: 'Termin löschen', ok: 'Löschen', danger: true })) return;
      await deleteEvent(ctx.calId, ev.subcalId, ev.id);
    }
    close();
    toast('Termin gelöscht');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

// ---------- Bearbeiten ----------

const FREQS = [['', 'Keine Wiederholung'], ['daily', 'Täglich'], ['weekly', 'Wöchentlich'], ['monthly', 'Monatlich'], ['yearly', 'Jährlich']];

// scope 'one': nur das angeklickte Vorkommen (wird aus der Serie gelöst), 'all': ganzer Termin.
export function openEventEditor(ctx, { ev = null, occ = null, scope = 'all', defaults = {}, copy = false } = {}) {
  const subs = ctx.writableSubcals();
  if (!subs.length) return toast('Du darfst in keinem Unterkalender Termine anlegen.', 'error');
  const editing = !!ev && !copy;

  let init;
  if (ev) {
    const useOcc = scope === 'one' && occ;
    init = {
      ...ev,
      start: useOcc ? occ.start : parse(ev.start),
      end: useOcc ? (ev.allDay ? addDays(occ.end, -1) : occ.end) : parse(ev.end),
      rrule: useOcc ? null : ev.rrule,
    };
  } else {
    const date = defaults.date || ymd(new Date());
    const allDay = !!defaults.allDay;
    const start = parse(`${date}T${defaults.time || '09:00'}`);
    init = { title: '', allDay, start: allDay ? parse(date) : start, end: allDay ? parse(date) : addMinutes(start, 60), subcalId: defaults.subcalId, rrule: null };
  }
  const firstVisible = ctx.visibleSubcals().find(s => ctx.level(s.id) >= 3);
  const subcalId = subs.some(s => s.id === init.subcalId) ? init.subcalId : (firstVisible || subs[0]).id;
  const r = init.rrule || {};

  const f = {
    title: h('input', { type: 'text', value: init.title || '', maxlength: 200, placeholder: 'Titel', autofocus: true }),
    subcal: select(subs.map(s => [s.id, s.name]), subcalId),
    allDay: h('input', { type: 'checkbox', checked: init.allDay }),
    sDate: h('input', { type: 'date', value: ymd(init.start), required: true }),
    sTime: h('input', { type: 'time', value: hm(init.start), step: 300 }),
    eDate: h('input', { type: 'date', value: ymd(init.end), required: true }),
    eTime: h('input', { type: 'time', value: hm(init.end), step: 300 }),
    freq: select(FREQS, r.freq || ''),
    interval: h('input', { type: 'number', min: 1, max: 99, value: r.interval || 1 }),
    byday: WEEKDAYS.map((w, i) => h('input', { type: 'checkbox', value: i, checked: (r.byday || []).includes(i) })),
    endMode: select([['never', 'Nie'], ['until', 'Am Datum'], ['count', 'Nach Anzahl']], r.until ? 'until' : r.count ? 'count' : 'never'),
    until: h('input', { type: 'date', value: r.until || '' }),
    count: h('input', { type: 'number', min: 1, max: 999, value: r.count || 10 }),
    location: h('input', { type: 'text', value: init.location || '', maxlength: 300 }),
    who: h('input', { type: 'text', value: init.who || '', maxlength: 300 }),
    notes: h('textarea', { rows: 4, maxlength: 10000 }, init.notes || ''),
    signup: h('input', { type: 'checkbox', checked: !!init.signup?.enabled }),
    max: h('input', { type: 'number', min: 1, max: 9999, value: init.signup?.max || '', placeholder: 'unbegrenzt' }),
  };

  const timeBoxes = [f.sTime, f.eTime];
  const rruleBox = h('div', { class: 'rrule-box' },
    h('div', { class: 'row' }, field('Alle', h('span', { class: 'with-unit' }, f.interval, h('span', { class: 'unit' })))),
    h('div', { class: 'weekday-picks' }, WEEKDAYS.map((w, i) => h('label', { class: 'pick' }, f.byday[i], h('span', null, w)))),
    h('div', { class: 'row' }, field('Endet', f.endMode), f.until, f.count));
  const unit = rruleBox.querySelector('.unit');
  const maxBox = field('Max. Teilnehmer', f.max);

  const update = () => {
    timeBoxes.forEach(t => { t.hidden = f.allDay.checked; });
    rruleBox.hidden = !f.freq.value;
    unit.textContent = { daily: 'Tage', weekly: 'Wochen', monthly: 'Monate', yearly: 'Jahre' }[f.freq.value] || '';
    rruleBox.querySelector('.weekday-picks').hidden = f.freq.value !== 'weekly';
    f.until.hidden = f.endMode.value !== 'until';
    f.count.hidden = f.endMode.value !== 'count';
    maxBox.hidden = !f.signup.checked;
  };
  [f.allDay, f.freq, f.endMode, f.signup].forEach(x => x.addEventListener('change', update));

  // Beim Verschieben des Beginns bleibt die Dauer erhalten.
  const valueOf = (d, t) => parse(`${d.value}T${f.allDay.checked || !t.value ? '00:00' : t.value}`);
  let prevStart = valueOf(f.sDate, f.sTime);
  const onStart = () => {
    if (!f.sDate.value) return;
    const s = valueOf(f.sDate, f.sTime);
    const e = f.eDate.value ? valueOf(f.eDate, f.eTime) : s;
    const ne = new Date(s.getTime() + Math.max(0, e - prevStart));
    f.eDate.value = ymd(ne);
    if (!f.allDay.checked) f.eTime.value = hm(ne);
    prevStart = s;
  };
  f.sDate.addEventListener('change', onStart);
  f.sTime.addEventListener('change', onStart);

  const saveBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => form.requestSubmit() }, 'Speichern');
  const form = h('form', { class: 'event-form', onsubmit: submit },
    field('Titel', f.title),
    field('Unterkalender', f.subcal),
    h('label', { class: 'check' }, f.allDay, ' Ganztägig'),
    h('div', { class: 'row' }, field('Beginn', h('span', { class: 'dt' }, f.sDate, f.sTime)), field('Ende', h('span', { class: 'dt' }, f.eDate, f.eTime))),
    scope === 'one' && !copy ? h('p', { class: 'hint' }, 'Dieser Termin wird aus der Serie gelöst und einzeln gespeichert.') : field('Wiederholung', f.freq),
    scope === 'one' && !copy ? null : rruleBox,
    field('Ort', f.location),
    field('Wer', f.who),
    field('Beschreibung', f.notes),
    h('label', { class: 'check' }, f.signup, ' Anmeldungen erlauben'),
    maxBox,
    h('button', { type: 'submit', hidden: true }));
  update();

  const m = modal({
    title: editing ? 'Termin bearbeiten' : 'Neuer Termin',
    body: form,
    wide: true,
    actions: [btn('Abbrechen', () => m.close()), saveBtn],
  });

  async function submit(e) {
    e.preventDefault();
    const allDay = f.allDay.checked;
    if (!f.sDate.value || !f.eDate.value) return toast('Bitte Beginn und Ende angeben.', 'error');
    const start = allDay ? f.sDate.value : `${f.sDate.value}T${f.sTime.value || '00:00'}`;
    const end = allDay ? f.eDate.value : `${f.eDate.value}T${f.eTime.value || '00:00'}`;
    if (end < start) return toast('Das Ende liegt vor dem Beginn.', 'error');

    let rrule = null;
    if (f.freq.value && !(scope === 'one' && !copy)) {
      const byday = f.byday.filter(x => x.checked).map(x => Number(x.value));
      rrule = {
        freq: f.freq.value,
        interval: Math.min(99, Math.max(1, Number(f.interval.value) || 1)),
        byday: f.freq.value === 'weekly' ? (byday.length ? byday : [weekday(parse(start))]) : [],
        until: f.endMode.value === 'until' ? f.until.value || null : null,
        count: f.endMode.value === 'count' ? Math.max(1, Number(f.count.value) || 1) : null,
      };
      if (f.endMode.value === 'until' && (!rrule.until || rrule.until < start.slice(0, 10))) return toast('Das Serienende liegt vor dem Beginn.', 'error');
    }

    const target = f.subcal.value;
    const data = {
      title: f.title.value.trim(),
      allDay, start, end, rrule,
      exdates: editing && scope === 'all' ? ev.exdates || [] : [],
      location: f.location.value.trim(),
      who: f.who.value.trim(),
      notes: f.notes.value.trim(),
      signup: f.signup.checked ? { enabled: true, max: Number(f.max.value) || null } : null,
      createdAt: editing && scope === 'all' ? ev.createdAt : null,
    };

    saveBtn.disabled = true;
    try {
      if (!editing) {
        await saveEvent(ctx.calId, target, null, data, ctx.uid);
      } else if (scope === 'one') {
        await b.batch([
          ...eventOps(ctx.calId, ev.subcalId, ev.id, { ...ev, exdates: [...(ev.exdates || []), occ.date] }, ev.createdBy),
          ...eventOps(ctx.calId, target, b.newId(), data, ctx.uid),
        ]);
      } else if (target !== ev.subcalId) {
        await moveEvent(ctx.calId, ev.subcalId, target, ev.id, data, ev.createdBy);
      } else {
        await saveEvent(ctx.calId, target, ev.id, data, ev.createdBy);
      }
      m.close();
      toast('Termin gespeichert');
    } catch (err) {
      toast(`Speichern fehlgeschlagen: ${errorText(err)}`, 'error');
      saveBtn.disabled = false;
    }
  }
}
