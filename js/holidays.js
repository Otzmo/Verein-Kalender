// Gesetzliche Feiertage für Deutschland (nach Bundesland), Österreich und die Schweiz.
import { ymd, addDays } from './dates.js';

export const HOLIDAY_REGIONS = [
  ['none', 'Keine Feiertage'],
  ['DE', 'Deutschland (nur bundesweite)'],
  ['DE-BW', 'Baden-Württemberg'],
  ['DE-BY', 'Bayern'],
  ['DE-BE', 'Berlin'],
  ['DE-BB', 'Brandenburg'],
  ['DE-HB', 'Bremen'],
  ['DE-HH', 'Hamburg'],
  ['DE-HE', 'Hessen'],
  ['DE-MV', 'Mecklenburg-Vorpommern'],
  ['DE-NI', 'Niedersachsen'],
  ['DE-NW', 'Nordrhein-Westfalen'],
  ['DE-RP', 'Rheinland-Pfalz'],
  ['DE-SL', 'Saarland'],
  ['DE-SN', 'Sachsen'],
  ['DE-ST', 'Sachsen-Anhalt'],
  ['DE-SH', 'Schleswig-Holstein'],
  ['DE-TH', 'Thüringen'],
  ['AT', 'Österreich'],
  ['CH', 'Schweiz'],
];

// Ostersonntag nach der Gauß'schen Osterformel (gregorianisch).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7;
  const m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

// Buß- und Bettag: Mittwoch vor dem 23. November.
function repentanceDay(y) {
  const d = new Date(y, 10, 22);
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return d;
}

function listFor(country, y) {
  const E = easter(y);
  const fix = (m, d) => new Date(y, m - 1, d);
  const e = n => addDays(E, n);
  if (country === 'DE') return [
    [fix(1, 1), 'Neujahr'],
    [fix(1, 6), 'Heilige Drei Könige', ['BW', 'BY', 'ST']],
    [fix(3, 8), 'Internationaler Frauentag', ['BE', 'MV']],
    [e(-2), 'Karfreitag'],
    [E, 'Ostersonntag', ['BB']],
    [e(1), 'Ostermontag'],
    [fix(5, 1), 'Tag der Arbeit'],
    [e(39), 'Christi Himmelfahrt'],
    [e(49), 'Pfingstsonntag', ['BB']],
    [e(50), 'Pfingstmontag'],
    [e(60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']],
    [fix(8, 15), 'Mariä Himmelfahrt', ['SL']],
    [fix(9, 20), 'Weltkindertag', ['TH']],
    [fix(10, 3), 'Tag der Deutschen Einheit'],
    [fix(10, 31), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']],
    [fix(11, 1), 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']],
    [repentanceDay(y), 'Buß- und Bettag', ['SN']],
    [fix(12, 25), '1. Weihnachtstag'],
    [fix(12, 26), '2. Weihnachtstag'],
  ];
  if (country === 'AT') return [
    [fix(1, 1), 'Neujahr'],
    [fix(1, 6), 'Heilige Drei Könige'],
    [e(1), 'Ostermontag'],
    [fix(5, 1), 'Staatsfeiertag'],
    [e(39), 'Christi Himmelfahrt'],
    [e(50), 'Pfingstmontag'],
    [e(60), 'Fronleichnam'],
    [fix(8, 15), 'Mariä Himmelfahrt'],
    [fix(10, 26), 'Nationalfeiertag'],
    [fix(11, 1), 'Allerheiligen'],
    [fix(12, 8), 'Mariä Empfängnis'],
    [fix(12, 25), 'Christtag'],
    [fix(12, 26), 'Stefanitag'],
  ];
  if (country === 'CH') return [
    [fix(1, 1), 'Neujahr'],
    [fix(1, 2), 'Berchtoldstag'],
    [e(-2), 'Karfreitag'],
    [e(1), 'Ostermontag'],
    [e(39), 'Auffahrt'],
    [e(50), 'Pfingstmontag'],
    [fix(8, 1), 'Bundesfeiertag'],
    [fix(12, 25), 'Weihnachtstag'],
    [fix(12, 26), 'Stephanstag'],
  ];
  return [];
}

const cache = new Map();

function holidaysFor(region, y) {
  const key = `${region}:${y}`;
  if (!cache.has(key)) {
    const [country, state] = region.split('-');
    const map = new Map();
    for (const [date, name, states] of listFor(country, y)) {
      if (states && !states.includes(state)) continue;
      const k = ymd(date);
      map.set(k, [...(map.get(k) || []), name]);
    }
    cache.set(key, map);
  }
  return cache.get(key);
}

export function holidayNames(region, date) {
  if (!region || region === 'none') return [];
  return holidaysFor(region, date.getFullYear()).get(ymd(date)) || [];
}
