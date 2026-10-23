// Öffentliche Buchungsseite eines Buchungslinks: zeigt freie Zeiten und trägt Buchungen ein.
import { h, modal, btn, field, toast, download, errorText } from './ui.js';
import { backend as b, watchEvents, eventOps, getCalendar } from './data.js';
import { occurrences, ymd, ymdhm, hm, addDays, addMinutes, startOfDay, startOfWeek, weekday, fmtDay, fmtShort, WEEKDAYS } from './dates.js';
import { toICS } from './ics.js';

export async function renderBooking(root, { link, user, onCleanup, app }) {
  const bk = link.booking;
  const cal = await getCalendar(link.calendarId);
  const today = startOfDay(new Date());
  const lastDay = addDays(today, bk.daysAhead || 60);
  const busy = new Map();
  let week = startOfWeek(today);
  let done = null; // gebuchter Termin für die Bestätigung

  const unsubs = (bk.availability || []).map(s => watchEvents(link.calendarId, s, ymd(today), true, rows => {
    busy.set(s, rows);
    draw();
  }, e => toast(errorText(e), 'error')));
  onCleanup(() => unsubs.forEach(u => u()));

  function slotsFor(day) {
    const hrs = bk.hours?.[weekday(day)];
    if (!hrs || day > lastDay) return [];
    const [fh, fm] = hrs.from.split(':').map(Number);
    const [th, tm] = hrs.to.split(':').map(Number);
    const minStart = new Date(Date.now() + (bk.notice || 0) * 3600000);
    const taken = [...busy.values()].flat().flatMap(ev => occurrences(ev, day, addDays(day, 1)));
    const out = [];
    for (let t = fh * 60 + fm; t + bk.duration <= th * 60 + tm; t += bk.duration) {
      const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t);
      const e = addMinutes(s, bk.duration);
      if (s < minStart) continue;
      if (taken.some(o => o.start < e && o.end > s)) continue;
      out.push(s);
    }
    return out;
  }

  function draw() {
    if (done) return;
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
    const canBack = week > startOfWeek(today);
    const canNext = addDays(week, 7) <= lastDay;
    root.replaceChildren(h('div', { class: 'booking' },
      h('header', { class: 'booking-head' },
        h('div', { class: 'muted' }, cal?.name || ''),
        h('h1', null, link.name),
        h('p', { class: 'muted' }, `Dauer: ${bk.duration} Minuten`),
        bk.description ? h('p', null, bk.description) : null),
      h('div', { class: 'booking-nav' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Vorherige Woche', disabled: !canBack, onclick: () => { week = addDays(week, -7); draw(); } }, '‹'),
        h('strong', null, `${fmtShort(days[0])} – ${fmtShort(days[6])}${days[6].getFullYear()}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nächste Woche', disabled: !canNext, onclick: () => { week = addDays(week, 7); draw(); } }, '›'),
        h('button', { type: 'button', class: 'icon-btn theme-btn', title: 'Hell/Dunkel', 'aria-label': 'Hell oder dunkel', onclick: () => app.toggleTheme() }, '◐')),
      h('div', { class: 'booking-days' }, days.map(d => {
        const slots = slotsFor(d);
        return h('section', { class: 'booking-day' },
          h('h3', null, `${WEEKDAYS[weekday(d)]} ${fmtShort(d)}`),
          slots.length
            ? h('div', { class: 'slots' }, slots.map(s => h('button', { type: 'button', class: 'slot', onclick: () => book(s) }, hm(s))))
            : h('p', { class: 'muted small' }, 'Keine freien Zeiten'));
      }))));
  }

  function book(start) {
    const end = addMinutes(start, bk.duration);
    const name = h('input', { type: 'text', required: true, maxlength: 100, autocomplete: 'name' });
    const email = h('input', { type: 'email', required: true, maxlength: 200, autocomplete: 'email' });
    const phone = h('input', { type: 'tel', maxlength: 50, autocomplete: 'tel' });
    const note = h('textarea', { rows: 3, maxlength: 2000 });
    const form = h('form', {
      class: 'stack',
      onsubmit: async e => {
        e.preventDefault();
        if (!name.value.trim() || !email.value.trim()) return;
        // Kurz vor dem Speichern noch einmal prüfen, ob die Zeit inzwischen vergeben ist.
        if (!slotsFor(startOfDay(start)).some(s => +s === +start)) {
          toast('Diese Zeit ist leider nicht mehr frei.', 'error');
          m.close();
          return;
        }
        const data = {
          title: `${link.name}: ${name.value.trim()}`,
          start: ymdhm(start), end: ymdhm(end), allDay: false,
          who: name.value.trim(),
          notes: [`E-Mail: ${email.value.trim()}`, phone.value.trim() && `Telefon: ${phone.value.trim()}`, note.value.trim() && `Nachricht: ${note.value.trim()}`].filter(Boolean).join('\n'),
        };
        submitBtn.disabled = true;
        try {
          const id = b.newId();
          await b.batch(eventOps(link.calendarId, link.bookTarget, id, data, user.uid));
          m.close();
          done = { ...data, id, subcalId: link.bookTarget };
          confirmation(start);
        } catch (err) {
          toast(`Buchung fehlgeschlagen: ${errorText(err)}`, 'error');
          submitBtn.disabled = false;
        }
      },
    },
    h('p', null, h('strong', null, `${fmtDay(start)}, ${hm(start)}–${hm(end)} Uhr`)),
    field('Name *', name), field('E-Mail *', email), field('Telefon', phone), field('Nachricht', note),
    h('button', { type: 'submit', hidden: true }));
    const submitBtn = btn('Verbindlich buchen', () => form.requestSubmit(), 'primary');
    const m = modal({ title: link.name, body: form, actions: [btn('Abbrechen', () => m.close()), submitBtn] });
  }

  function confirmation(start) {
    const ctx = { st: { cal }, subcal: () => null };
    root.replaceChildren(h('div', { class: 'booking done' },
      h('div', { class: 'big-check' }, '✓'),
      h('h1', null, 'Gebucht!'),
      h('p', null, `${link.name} am ${fmtDay(start)} um ${hm(start)} Uhr.`),
      h('div', { class: 'row gap center' },
        btn('Zum eigenen Kalender hinzufügen (.ics)', () => download('buchung.ics', toICS([done], ctx), 'text/calendar')),
        btn('Weiteren Termin buchen', () => { done = null; draw(); }, 'primary'))));
  }

  draw();
}
