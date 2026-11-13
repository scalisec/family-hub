// The family's data, as kept in the Drive file. Pure functions only (no network), so they can be tested.
//
// Every record has an id and `u` (when it last changed). Deleting leaves a small marker ({ id, del, u })
// so a phone that was offline can't bring the item back. Two copies merge record by record: the newer
// change wins. That way two people editing different things at once never lose each other's changes.

export const COLLECTIONS = ['people', 'feeds', 'rules', 'recipes', 'meals', 'groceries', 'todos', 'settings'];
import { THEMES, resolveTheme, gameDayTheme } from './themes.js';

export { THEMES };
export const TILES = [
  ['nextUp', 'Next up and leave-by'],
  ['week', 'This week'],
  ['meals', 'Meals and lunches'],
  ['todos', 'To-dos'],
  ['groceries', 'Groceries'],
  ['joke', 'Joke of the day'],
  ['quote', 'Quote of the day'],
];
export const PERSON_COLORS = ['#2563EB', '#DB2777', '#16A34A', '#EA580C', '#7C3AED', '#0891B2', '#CA8A04', '#475569'];
const DAY = 86400000;

export function emptyData() {
  const d = { v: 1 };
  for (const c of COLLECTIONS) d[c] = {};
  return d;
}

let lastId = '';
export function newId() {
  let id;
  do { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); } while (id === lastId);
  lastId = id;
  return id;
}

// Makes any file content safe to use (missing collections, junk records).
export function normalize(raw) {
  const d = emptyData();
  if (!raw || typeof raw !== 'object') return d;
  for (const c of COLLECTIONS) {
    const src = raw[c];
    if (!src || typeof src !== 'object') continue;
    for (const [id, rec] of Object.entries(src)) {
      if (!rec || typeof rec !== 'object') continue;
      d[c][id] = { ...rec, id, u: Number(rec.u) || 0 };
    }
  }
  return d;
}

// Newer change wins, record by record. Ties keep `a`.
export function merge(a, b) {
  const A = normalize(a);
  const B = normalize(b);
  const out = emptyData();
  for (const c of COLLECTIONS) {
    const ids = new Set([...Object.keys(A[c]), ...Object.keys(B[c])]);
    for (const id of ids) {
      const x = A[c][id];
      const y = B[c][id];
      out[c][id] = !x ? y : !y ? x : (y.u > x.u ? y : x);
    }
  }
  return out;
}

export function same(a, b) { return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)); }

// Live records of a collection, as a list.
export function live(data, c) {
  return Object.values((data && data[c]) || {}).filter((r) => r && !r.del);
}
export function get(data, c, id) {
  const r = data[c] && data[c][id];
  return r && !r.del ? r : null;
}

// Returns a new data object with the record added or changed.
export function put(data, c, rec, now = Date.now()) {
  const id = rec.id || newId();
  const prev = get(data, c, id) || {};
  const raw = (data[c] && data[c][id]) || {};
  const { u: _ignore, del: _del, ...fields } = rec;
  return { ...data, [c]: { ...data[c], [id]: { ...prev, ...fields, id, u: Math.max(now, (raw.u || 0) + 1) } } };
}

export function remove(data, c, id, now = Date.now()) {
  const prev = data[c] && data[c][id];
  return { ...data, [c]: { ...data[c], [id]: { id, del: true, u: Math.max(now, ((prev && prev.u) || 0) + 1) } } };
}

export function setting(data, key, fallback = '') {
  const r = get(data, 'settings', key);
  return r && r.value !== undefined && r.value !== null && r.value !== '' ? r.value : fallback;
}
export function setSetting(data, key, value, now) { return put(data, 'settings', { id: key, value }, now); }

// Drops delete markers older than 30 days and ticked groceries older than 7 days.
export function prune(data, now = Date.now()) {
  const out = emptyData();
  for (const c of COLLECTIONS) {
    for (const [id, r] of Object.entries(data[c] || {})) {
      if (r.del && now - r.u > 30 * DAY) continue;
      if (c === 'groceries' && r.done && now - r.u > 7 * DAY) continue;
      if (c === 'meals' && !r.del && r.date && r.date < dateKey(new Date(now - 60 * DAY))) continue;
      out[c][id] = r;
    }
  }
  return out;
}

export function dateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export const mealId = (date, slot) => `${date}|${slot}`;

export function people(data) {
  return live(data, 'people').sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(b.name));
}
export const kids = (data) => people(data).filter((p) => p.role === 'kid');
export function initial(p, all) {
  if (p.short) return p.short;
  const first = String(p.name || '?').trim();
  const clash = (all || []).some((o) => o.id !== p.id && String(o.name || '').trim()[0]?.toLowerCase() === first[0]?.toLowerCase());
  return clash ? first.slice(0, 2) : first.slice(0, 1).toUpperCase();
}

export function layout(data) {
  const saved = setting(data, 'layout', {});
  const out = {};
  for (const [k] of TILES) out[k] = saved[k] !== false;
  return out;
}

// What the wall needs and what the helper needs to read the calendars. Sent to the helper after changes.
export function snapshot(data, now = Date.now()) {
  const today = dateKey(new Date(now));
  const end = dateKey(new Date(now + 7 * DAY));
  const recipes = data.recipes || {};
  const ppl = people(data);
  return {
    people: ppl.map((p) => ({ id: p.id, name: p.name, short: initial(p, ppl), color: p.color, role: p.role })),
    feeds: live(data, 'feeds').map((f) => ({ calendarId: f.calendarId, name: f.name, person: f.person || '' })),
    rules: live(data, 'rules').map((r) => ({ kw: r.kw, person: r.person || '', min: Number(r.min) || 0 })),
    meals: live(data, 'meals').filter((m) => m.date >= today && m.date < end).map((m) => ({
      date: m.date, slot: m.slot, text: m.recipe && recipes[m.recipe] && !recipes[m.recipe].del ? recipes[m.recipe].name : (m.text || ''),
    })).filter((m) => m.text),
    groceries: live(data, 'groceries').filter((g) => !g.done).sort((a, b) => a.u - b.u).map((g) => ({ text: g.text })),
    todos: live(data, 'todos').filter((t) => !t.done).sort(byDue).map((t) => ({ text: t.text, who: t.who || 'family', due: t.due || '' })),
    homeAddress: setting(data, 'homeAddress', ''),
    place: setting(data, 'place', null),
    theme: setting(data, 'theme', 'Rink'),
    themeBase: setting(data, 'themeBase', 'Rink'),
    teamThemes: setting(data, 'teamThemes', null),
    teamLogos: setting(data, 'teamLogos', {}),
    calendar: setting(data, 'calendar', {}),
    photos: photoSettings(data),
    layout: layout(data),
    dim: setting(data, 'dim', { from: '22:00', to: '06:00' }),
  };
}

// events: the calendar feed, for team themes on game days.
export function currentTheme(data, date = new Date(), events = []) {
  const teams = setting(data, 'teamThemes', null);
  const game = teams && teams.on ? gameDayTheme(events, teams.list, date.getTime()) : null;
  return resolveTheme(setting(data, 'theme', 'Rink'), setting(data, 'themeBase', 'Rink'), date, game);
}

// Wall photo settings. slideshow: 'off' | 'schedule'. night: show the slideshow instead of dimming.
export function photoSettings(data) {
  const s = setting(data, 'photos', {});
  return {
    tile: s.tile !== false,
    slideshow: s.slideshow === 'schedule' ? 'schedule' : 'off',
    from: s.from || '19:00',
    to: s.to || '20:30',
    days: ['all', 'weekdays', 'weekends'].includes(s.days) ? s.days : 'all',
    night: Boolean(s.night),
    every: [10, 20, 30, 60, 120].includes(Number(s.every)) ? Number(s.every) : 30,
  };
}

export function byDue(a, b) {
  return (a.due || '9999') .localeCompare(b.due || '9999') || (a.u - b.u);
}

// A new family file: the arrival rules from the old version, and nothing personal.
export function starterData(now = Date.now()) {
  let d = emptyData();
  const rules = [['game', 60], ['vs', 60], ['at', 60], ['tournament', 60], ['practice', 15]];
  for (const [kw, min] of rules) d = put(d, 'rules', { kw, min, person: '' }, now);
  d = setSetting(d, 'theme', 'Rink', now);
  return d;
}

// Turns the old version's sheet tabs (from the helper's "import") into this version's records.
export function fromV2(old, now = Date.now()) {
  let d = emptyData();
  if (!old) return d;
  const byName = {};
  (old.people || []).forEach((p, i) => {
    const name = String(p.name || '').trim();
    if (!name || name === 'Family') return;
    const id = newId();
    byName[name] = id;
    d = put(d, 'people', { id, name, color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PERSON_COLORS[i % PERSON_COLORS.length],
      role: p.role === 'kid' ? 'kid' : 'adult', email: String(p.email || '').toLowerCase(), order: i }, now);
  });
  const who = (name) => byName[String(name || '').trim()] || '';
  (old.feeds || []).forEach((f) => {
    if (!f.calendar_id) return;
    d = put(d, 'feeds', { calendarId: String(f.calendar_id), name: String(f.name || ''), person: who(f.person) }, now);
  });
  (old.rules || []).forEach((r) => {
    if (!r.keyword) return;
    d = put(d, 'rules', { kw: String(r.keyword).toLowerCase(), person: who(r.person), min: Number(r.arrive_early_min) || 0 }, now);
  });
  const recipeIds = {};
  (old.recipes || []).forEach((r) => {
    if (!r.name) return;
    const id = newId();
    recipeIds[String(r.id || r.name)] = id;
    recipeIds[String(r.name)] = id;
    d = put(d, 'recipes', { id, name: String(r.name), link: String(r.url || ''), kind: r.type === 'lunch' ? 'lunch' : r.type === 'dinner' ? 'dinner' : 'any',
      ingredients: String(r.ingredients || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean), notes: String(r.notes || '') }, now);
  });
  (old.meals || []).forEach((m) => {
    if (!m.date || !m.slot || !m.recipe) return;
    const slot = m.slot === 'dinner' ? 'dinner' : m.slot.startsWith('lunch') ? `lunch:${who(m.slot.replace(/^lunch[:\s-]*/i, '')) || m.slot}` : m.slot;
    const rid = recipeIds[String(m.recipe)];
    d = put(d, 'meals', { id: mealId(m.date, slot), date: m.date, slot, recipe: rid || '', text: rid ? '' : String(m.recipe) }, now);
  });
  (old.groceries || []).forEach((g) => {
    if (!g.item) return;
    d = put(d, 'groceries', { text: String(g.item), done: String(g.done).toUpperCase() === 'TRUE' }, now);
  });
  (old.todos || []).forEach((t) => {
    if (!t.text) return;
    d = put(d, 'todos', { text: String(t.text), who: who(t.person) || 'family', due: /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : '', done: String(t.done).toUpperCase() === 'TRUE' }, now);
  });
  const s = old.settings || {};
  if (s.theme && THEMES.includes(s.theme)) d = setSetting(d, 'theme', s.theme, now);
  if (s.home_address) d = setSetting(d, 'homeAddress', s.home_address, now);
  if (s.latitude && s.longitude && isFinite(Number(s.latitude))) {
    d = setSetting(d, 'place', { name: s.location_name || 'Home', lat: Number(s.latitude), lon: Number(s.longitude) }, now);
  }
  if (s.dim_from && s.dim_to) d = setSetting(d, 'dim', { from: s.dim_from, to: s.dim_to }, now);
  if (!live(d, 'rules').length) d = merge(d, starterData(now));
  if (!get(d, 'settings', 'theme')) d = setSetting(d, 'theme', 'Rink', now);
  const me = live(d, 'people').find((p) => p.role === 'adult');
  if (me) d = setSetting(d, 'me', me.id, now);
  return d;
}
