// Calendar views shared by the app and the wall: week as a time grid, week as 7 columns, and month.
// Pure layout helpers are exported for the tests; the render functions build DOM with ui.js's h().
import { h } from './ui.js';
import * as dates from './dates.js';

const HOUR = 3600000;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function calSettings(raw) {
  const s = raw || {};
  return {
    weekStyle: s.weekStyle === 'columns' ? 'columns' : 'grid',
    wallView: s.wallView === 'month' ? 'month' : s.wallView === 'list' ? 'list' : 'week',
    weekStart: s.weekStart === 1 ? 1 : 0,
  };
}

export function weekStartOf(d, weekStart = 0) {
  const x = dates.startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() - weekStart + 7) % 7));
  return x;
}

// The 5 or 6 weeks shown for a month, starting on the week-start day.
export function monthDays(year, month, weekStart = 0) {
  const first = weekStartOf(new Date(year, month, 1), weekStart);
  const last = new Date(year, month + 1, 0);
  const days = [];
  for (let d = new Date(first); d <= last || days.length % 7; d = dates.addDays(d, 1)) days.push(new Date(d));
  return days;
}

export function eventsOn(events, day) {
  const a = dates.startOfDay(day).getTime();
  const b = dates.addDays(new Date(a), 1).getTime();
  return events.filter((e) => e.start < b && e.end > a).sort((x, y) => (y.allDay ? 1 : 0) - (x.allDay ? 1 : 0) || x.start - y.start);
}

// Hours to show in the grid: 7 am to 9 pm, stretched to fit early or late events (5 am to midnight at most).
export function hourRange(timed, days) {
  let lo = 7;
  let hi = 21;
  for (const e of timed) {
    const d0 = dates.startOfDay(new Date(e.start)).getTime();
    if (!days.some((d) => d.getTime() === d0)) continue;
    const s = (e.start - d0) / HOUR;
    const f = Math.min(24, (e.end - d0) / HOUR);
    lo = Math.min(lo, Math.floor(s));
    hi = Math.max(hi, Math.ceil(f));
  }
  return [Math.max(5, lo), Math.min(24, hi)];
}

// Side-by-side lanes for events that overlap in time. Returns [{ e, lane, lanes }].
export function lanes(list) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let group = [];
  let groupEnd = -Infinity;
  const flush = () => {
    const ends = [];
    const placed = group.map((e) => {
      let lane = ends.findIndex((end) => end <= e.start);
      if (lane < 0) { lane = ends.length; ends.push(e.end); } else ends[lane] = e.end;
      return { e, lane };
    });
    for (const p of placed) out.push({ ...p, lanes: ends.length });
    group = [];
  };
  for (const e of sorted) {
    if (group.length && e.start >= groupEnd) { flush(); groupEnd = -Infinity; }
    group.push(e);
    groupEnd = Math.max(groupEnd, e.end);
  }
  if (group.length) flush();
  return out;
}

const isToday = (d) => dates.dateKey(d) === dates.dateKey(new Date());

/* ---------- Week: time grid ---------- */
export function weekGrid(events, start, { tag, onEvent, onDay } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => dates.addDays(start, i));
  const all = days.map((d) => eventsOn(events, d));
  const timed = all.flat().filter((e) => !e.allDay);
  const [h0, h1] = hourRange(timed, days);
  const span = h1 - h0;
  const pct = (hrs) => `${((hrs - h0) / span) * 100}%`;
  const hasAllDay = all.some((l) => l.some((e) => e.allDay));
  const now = Date.now();

  const head = h('div', { class: 'cg-head' }, h('div'), days.map((d) => h('button', { class: `cg-day${isToday(d) ? ' today' : ''}`, type: 'button', onclick: onDay ? () => onDay(d) : null },
    h('span', { class: 'cg-dow' }, WEEKDAY_SHORT[d.getDay()]), h('span', { class: 'cg-num' }, String(d.getDate())))));
  const allDay = hasAllDay ? h('div', { class: 'cg-allday' }, h('div', { class: 'cg-gut' }, 'all day'),
    all.map((list) => h('div', { class: 'cg-adcell' }, list.filter((e) => e.allDay).map((e) => h('button', { class: 'cg-ad', type: 'button', style: { background: e.color || 'var(--accent)' }, onclick: onEvent ? () => onEvent(e) : null }, e.title))))) : null;

  const hours = [];
  for (let hr = h0 + 1; hr < h1; hr += 1) hours.push(hr);
  const gutter = h('div', { class: 'cg-gutter' }, hours.map((hr) => h('span', { style: { top: pct(hr) } }, `${((hr + 11) % 12) + 1}${hr < 12 ? 'am' : 'pm'}`)));
  const cols = days.map((d, i) => {
    const d0 = d.getTime();
    const placed = lanes(all[i].filter((e) => !e.allDay).map((e) => ({ ...e, start: Math.max(e.start, d0 + h0 * HOUR), end: Math.min(e.end, d0 + h1 * HOUR), _orig: e })));
    const col = h('div', { class: `cg-col${isToday(d) ? ' today' : ''}` },
      placed.map(({ e, lane, lanes: n }) => {
        const top = (e.start - d0) / HOUR;
        const len = Math.max(0.5, (e.end - e.start) / HOUR);
        const o = e._orig;
        return h('button', { class: `cg-ev${len < 0.9 ? ' short' : ''}`, type: 'button', onclick: onEvent ? () => onEvent(o) : null, style: {
          top: pct(top), height: `${(len / span) * 100}%`, left: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)`, background: o.color || 'var(--accent)',
        } }, h('b', null, o.title), h('span', { class: 'cg-t' }, dates.time(o.start), tag ? [' ', tag(o.person)] : null));
      }),
      isToday(d) && now > d0 + h0 * HOUR && now < d0 + h1 * HOUR ? h('div', { class: 'cg-now', style: { top: pct((now - d0) / HOUR) } }) : null);
    return col;
  });
  const lines = hours.map((hr) => h('div', { class: 'cg-line', style: { top: pct(hr) } }));
  return h('div', { class: 'calgrid' }, head, allDay, h('div', { class: 'cg-body' }, gutter, h('div', { class: 'cg-cols' }, lines, cols)));
}

/* ---------- Week: 7 columns ---------- */
export function weekColumns(events, start, { tag, onEvent, onDay, dinner } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => dates.addDays(start, i));
  return h('div', { class: 'calcols' }, days.map((d) => {
    const list = eventsOn(events, d);
    const din = dinner ? dinner(d) : '';
    return h('div', { class: `cc-day${isToday(d) ? ' today' : ''}` },
      h('button', { class: 'cc-head', type: 'button', onclick: onDay ? () => onDay(d) : null }, h('span', null, WEEKDAY_SHORT[d.getDay()]), h('span', null, String(d.getDate()))),
      list.map((e) => h('button', { class: 'cc-ev', type: 'button', style: { borderColor: e.color || 'var(--accent)' }, onclick: onEvent ? () => onEvent(e) : null },
        h('span', { class: 'cc-t' }, e.allDay ? 'All day' : dates.time(e.start), tag ? [' ', tag(e.person)] : null), h('b', null, e.title))),
      din ? h('div', { class: 'cc-dinner' }, `Dinner: ${din}`) : null);
  }));
}

/* ---------- Month ---------- */
export function monthGrid(events, year, month, { weekStart = 0, onDay, max = 3 } = {}) {
  const days = monthDays(year, month, weekStart);
  const dow = Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(i + weekStart) % 7]);
  return h('div', { class: 'calmonth', style: { gridTemplateRows: `auto repeat(${days.length / 7}, 1fr)` } },
    dow.map((d) => h('div', { class: 'cm-dow' }, d)),
    days.map((d) => {
      const list = eventsOn(events, d);
      const off = d.getMonth() !== month;
      return h('button', { class: `cm-day${off ? ' off' : ''}${isToday(d) ? ' today' : ''}`, type: 'button', onclick: onDay ? () => onDay(d) : null },
        h('span', { class: 'cm-num' }, String(d.getDate())),
        list.slice(0, max).map((e) => h('span', { class: 'cm-ev' }, h('i', { style: { background: e.color || 'var(--accent)' } }), e.title)),
        list.length > max ? h('span', { class: 'cm-more' }, `+${list.length - max} more`) : null);
    }));
}

export function monthTitle(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
}

export function weekTitle(start) {
  const end = dates.addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const a = start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const b = end.toLocaleDateString('en-CA', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${a} – ${b}`;
}
