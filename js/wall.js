// Wall screen: read-only, no sign-in. Reads the helper's feed with the secret key in the link
// (wall.html#k=...), refreshes every 2 minutes, and keeps the last copy so it survives Wi-Fi blips.
import { h, icon } from './ui.js';
import * as dates from './dates.js';
import { wallFeed, wallPhoto } from './relay.js';
import { resolveTheme, gameDayTheme, SEASONAL_THEMES, TEAM_THEMES } from './themes.js';
import { getWeather, cachedWeather, wxIcon } from './weather.js';
import { VERSION, latestVersion, compareVersions } from './version.js';

const CACHE = 'fh.wall';
const key = new URLSearchParams(location.hash.slice(1)).get('k') || '';
let feed = null;
let wx = null;
let problem = '';

try { feed = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { feed = null; }

const snap = () => (feed && feed.snapshot) || {};
const peopleById = () => Object.fromEntries((snap().people || []).map((p) => [p.id, p]));

function tag(id) {
  const p = peopleById()[id];
  if (!p) return h('span', { class: 'ptag fam' }, 'F');
  return h('span', { class: 'ptag', style: { borderColor: p.color, color: p.color } }, p.short || p.name[0]);
}

function tile(name, title, body, cls = '') {
  const lay = snap().layout || {};
  if (lay[name] === false) return null;
  return h('section', { class: `card ${cls}` }, title ? h('h2', null, title) : null, body);
}

function eventsOn(day) {
  const a = dates.startOfDay(day).getTime();
  const b = a + dates.DAY;
  return ((feed && feed.feed && feed.feed.events) || []).filter((e) => e.start < b && e.end > a);
}

function nextUp() {
  const now = Date.now();
  const list = ((feed && feed.feed && feed.feed.nextUp) || []).filter((e) => e.start > now).slice(0, 2);
  if (!list.length) return h('p', { class: 'empty' }, 'Nothing coming up.');
  return list.map((e) => h('div', { class: 'nu' },
    h('span', { class: 'bar', style: { background: e.color || 'var(--accent)' } }),
    h('div', { class: 'nu-main' },
      h('div', { class: 'nu-title' }, e.title, ' ', tag(e.person)),
      h('div', { class: 'muted' }, `${dates.dayLabel(new Date(e.start))} ${dates.time(e.start)}`, e.location ? ` · ${e.location.split(',')[0]}` : ''),
      e.leave ? h('div', { class: `leave${e.leave - now < 45 * 60000 ? ' soon' : ''}` }, icon('car'), `Leave by ${dates.time(e.leave)}`, h('span', { class: 'muted' }, ` ${dates.inLabel(e.leave)}`))
        : e.arriveBy ? h('div', { class: 'leave' }, icon('clock'), `Be there by ${dates.time(e.arriveBy)}`) : null)));
}

function week() {
  const start = dates.startOfDay();
  const meals = Object.fromEntries((snap().meals || []).filter((m) => m.slot === 'dinner').map((m) => [m.date, m.text]));
  return Array.from({ length: 7 }, (_, i) => dates.addDays(start, i)).map((day, i) => {
    const list = eventsOn(day);
    const dinner = meals[dates.dateKey(day)];
    return h('div', { class: `day${i === 0 ? ' today' : ''}` },
      h('div', { class: 'day-label' }, h('div', { class: 'day-num' }, String(day.getDate())), h('div', { class: 'muted small' }, i === 0 ? 'Today' : day.toLocaleDateString('en-CA', { weekday: 'short' }))),
      h('div', { class: 'day-events' },
        list.length ? list.slice(0, 6).map((e) => h('span', { class: 'evchip' }, h('span', { class: 'dot', style: { background: e.color || 'var(--accent)' } }),
          h('span', { class: 'evt' }, e.allDay ? '' : `${dates.time(e.start)} `, h('b', null, e.title)), tag(e.person))) : h('span', { class: 'muted small' }, 'Free'),
        list.length > 6 ? h('span', { class: 'muted small' }, `+${list.length - 6} more`) : null,
        dinner ? h('span', { class: 'dinner muted small' }, icon('meals'), dinner) : null));
  });
}

function mealsToday() {
  const today = dates.dateKey(new Date());
  const ppl = snap().people || [];
  const meals = (snap().meals || []).filter((m) => m.date === today);
  const dinner = meals.find((m) => m.slot === 'dinner');
  const weekend = dates.isWeekend(new Date());
  return h('div', { class: 'meals' },
    h('div', { class: 'meal' }, h('span', { class: 'muted small' }, 'Dinner'), h('div', { class: 'strong' }, dinner ? dinner.text : 'Not planned')),
    weekend ? null : ppl.filter((p) => p.role === 'kid').map((k) => {
      const m = meals.find((x) => x.slot === `lunch:${k.id}`);
      return h('div', { class: 'meal' }, h('span', { class: 'muted small' }, tag(k.id), ` ${String(k.name).trim().split(/\s+/)[0]}'s lunch`), h('div', { class: 'strong' }, m ? m.text : 'Not planned'));
    }));
}

function todos() {
  const list = (snap().todos || []).slice(0, 8);
  if (!list.length) return h('p', { class: 'empty' }, 'All done.');
  const today = dates.dateKey(new Date());
  return list.map((t) => h('div', { class: 'line' }, h('span', { class: 'box' }), h('span', { class: 'grow' }, t.text,
    t.due ? h('span', { class: `due${t.due < today ? ' late' : ''}` }, dates.dueLabel(t.due)) : null), tag(t.who)));
}

function groceries() {
  const list = snap().groceries || [];
  if (!list.length) return h('p', { class: 'empty' }, 'List is empty.');
  return h('div', { class: 'gro' }, list.slice(0, 14).map((g) => h('span', { class: 'chip' }, g.text)), list.length > 14 ? h('span', { class: 'muted small' }, `+${list.length - 14} more`) : null);
}

function daily() {
  const d = feed && feed.daily;
  const lay = snap().layout || {};
  if (!d) return null;
  const joke = lay.joke !== false ? h('div', { class: 'daily-part' }, h('div', { class: 'eyebrow' }, 'Joke of the day'), h('p', { class: 'daily-text' }, d.joke)) : null;
  const quote = lay.quote !== false ? h('div', { class: 'daily-part' }, h('div', { class: 'eyebrow' }, 'Quote of the day'),
    h('p', { class: 'daily-text' }, `\u201c${d.quote}\u201d`, d.author ? h('span', { class: 'muted' }, ` \u2014 ${d.author}`) : null),
    d.quoteCredit ? h('div', { class: 'credit' }, 'Inspirational quotes provided by ZenQuotes API') : null) : null;
  if (!joke && !quote) return null;
  return h('section', { class: 'card compact daily-wall' }, joke, quote);
}

/* ---------- photos ---------- */
const photoEl = h('div', { class: 'ptile' });
const memo = new Map();
let photoIndex = 0;
let photoTimer = null;
let showOn = false;
const showEl = h('div', { id: 'show' }, h('img', { class: 'a', alt: '' }), h('img', { class: 'b', alt: '' }), h('div', { class: 'show-clock' }));

const photoSettings = () => ({ tile: true, slideshow: 'off', from: '19:00', to: '20:30', days: 'all', night: false, every: 30, ...(snap().photos || {}) });
const photoIds = () => (feed && feed.photos) || [];

async function photoUrl(id) {
  if (memo.has(id)) return memo.get(id);
  let blob = null;
  try {
    const cache = await caches.open('fh-photos');
    const hit = await cache.match(`/photo/${id}`);
    if (hit) blob = await hit.blob();
    if (!blob) {
      const b64 = await wallPhoto(key, id);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      blob = new Blob([bytes], { type: 'image/jpeg' });
      await cache.put(`/photo/${id}`, new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
    }
  } catch {
    if (!blob) return null;
  }
  const url = URL.createObjectURL(blob);
  memo.set(id, url);
  if (memo.size > 12) { const [old, u] = memo.entries().next().value; URL.revokeObjectURL(u); memo.delete(old); }
  return url;
}

function shuffled(ids) {
  // Same order all day, different each day.
  const seed = Number(dates.dateKey(new Date()).replace(/-/g, ''));
  return ids.map((id, i) => [id, Math.sin(seed + i * 7.13) * 10000 % 1]).sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

async function nextPhoto() {
  const ids = shuffled(photoIds());
  if (!ids.length) { photoEl.replaceChildren(h('p', { class: 'empty' }, 'Add photos in the app: More > Photos and slideshow.')); return; }
  photoIndex = (photoIndex + 1) % ids.length;
  const url = await photoUrl(ids[photoIndex]);
  if (url) {
    if (showOn) {
      const [a, b] = showEl.querySelectorAll('img');
      const front = a.classList.contains('on') ? b : a;
      const back = front === a ? b : a;
      front.src = url;
      front.onload = () => { front.classList.add('on'); back.classList.remove('on'); };
    } else {
      const img = h('img', { src: url, alt: '' });
      img.onload = () => { photoEl.replaceChildren(img); requestAnimationFrame(() => img.classList.add('on')); };
    }
  }
  photoUrl(ids[(photoIndex + 1) % ids.length]); // get the next one ready
}

function restartPhotos() {
  clearInterval(photoTimer);
  if (!photoIds().length || (photoSettings().tile === false && !showOn)) return;
  nextPhoto();
  photoTimer = setInterval(nextPhoto, Math.max(10, Number(photoSettings().every) || 30) * 1000);
}

const mins = (t) => { const [a, b] = String(t).split(':').map(Number); return (a || 0) * 60 + (b || 0); };
function within(from, to, n) { const f = mins(from); const t = mins(to); return f > t ? (n >= f || n < t) : (n >= f && n < t); }

function slideshowNow(now = new Date()) {
  const ps = photoSettings();
  if (!photoIds().length) return false;
  const n = now.getHours() * 60 + now.getMinutes();
  const dow = now.getDay();
  const dayOk = ps.days === 'all' || (ps.days === 'weekends' ? (dow === 0 || dow === 6) : (dow > 0 && dow < 6));
  if (ps.slideshow === 'schedule' && dayOk && within(ps.from, ps.to, n)) return true;
  const d = snap().dim || { from: '22:00', to: '06:00' };
  return Boolean(ps.night) && within(d.from, d.to, n);
}

function updateShow() {
  const on = slideshowNow();
  showEl.querySelector('.show-clock').replaceChildren(h('div', { class: 'sc-time' }, dates.time(Date.now())), h('div', { class: 'sc-date' }, new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })));
  if (on !== showOn) {
    showOn = on;
    document.body.classList.toggle('slideshow', on);
    restartPhotos();
  }
}

function weather() {
  if (!wx) return null;
  return h('div', { class: 'wx' },
    icon(wxIcon(wx.code), 'wx-ic'),
    h('div', null, h('div', { class: 'wx-temp' }, `${wx.temp}°`), h('div', { class: 'muted small' }, `${wx.label}, feels ${wx.feels}°`)),
    h('span', { class: 'wx-sep' }),
    h('div', { class: 'wx-wear' }, wx.wear),
    h('div', { class: 'wx-days' }, wx.days.slice(1, 4).map((d) => h('div', { class: 'wx-day' }, h('div', { class: 'muted small' }, dates.fromKey(d.date).toLocaleDateString('en-CA', { weekday: 'short' })), icon(wxIcon(d.code)), h('div', { class: 'small' }, `${d.hi}° / ${d.lo}°`)))));
}

function render() {
  const s = snap();
  const teams = s.teamThemes;
  const game = teams && teams.on ? gameDayTheme((feed && feed.feed && feed.feed.events) || [], teams.list) : null;
  const theme = resolveTheme(s.theme || 'Rink', s.themeBase || 'Rink', new Date(), game);
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('fh.wallTheme', theme); } catch { /* fine */ }
  const deco = SEASONAL_THEMES.includes(theme) || TEAM_THEMES.includes(theme) || theme === 'Christmas';
  const root = document.getElementById('wall');
  if (!key) {
    root.replaceChildren(h('div', { class: 'wall-msg' }, h('h1', null, 'Family Hub wall'), h('p', null, 'Open the wall link from the app: More > Wall screen > Open.')));
    return;
  }
  if (!feed) {
    root.replaceChildren(h('div', { class: 'wall-msg' }, h('h1', null, 'Family Hub'), h('p', null, problem || 'Loading...')));
    return;
  }
  const now = new Date();
  root.replaceChildren(h('div', { class: 'wall' },
    deco ? h('div', { class: 'deco-band', 'aria-hidden': 'true' }) : null,
    h('header', { class: 'w-head' },
      h('div', null, h('div', { class: 'w-date' }, now.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })),
        h('div', { class: 'w-sub' }, h('span', { class: 'w-clock' }, dates.time(now.getTime())), problem ? h('span', { class: 'w-warn' }, ` · ${problem}`) : null)),
      weather()),
    h('div', { class: 'w-cols' },
      h('div', { class: 'col' }, tile('nextUp', 'Next up', h('div', null, nextUp()), 'grow'), tile('meals', 'Meals today', mealsToday())),
      h('div', { class: 'col' }, tile('week', 'This week', h('div', { class: 'week' }, week()), 'grow')),
      h('div', { class: 'col' }, tile('todos', 'To-dos', h('div', null, todos()), 'grow'), tile('groceries', 'Groceries', groceries()),
        photoSettings().tile !== false && photoIds().length ? h('section', { class: 'card photo-card' }, photoEl) : null)),
    daily()));
  dim();
}

function dim() {
  const d = snap().dim || { from: '22:00', to: '06:00' };
  const mins = (t) => { const [a, b] = String(t).split(':').map(Number); return (a || 0) * 60 + (b || 0); };
  const now = new Date();
  const n = now.getHours() * 60 + now.getMinutes();
  const f = mins(d.from);
  const t = mins(d.to);
  const on = f > t ? (n >= f || n < t) : (n >= f && n < t);
  document.body.classList.toggle('dimmed', on && !showOn);
}

async function loadFeed() {
  if (!key) return;
  try {
    const r = await wallFeed(key);
    if (!r.ok) { problem = r.error || 'The helper had a problem.'; render(); return; }
    feed = r;
    problem = '';
    try { localStorage.setItem(CACHE, JSON.stringify(feed)); } catch { /* fine */ }
    loadWeather();
    updateShow();
    if (!photoTimer) restartPhotos();
  } catch {
    problem = feed ? `Offline, last update ${dates.time((feed.feed && feed.feed.updated) || Date.now())}` : "Can't reach Family Hub. Check the Wi-Fi.";
  }
  render();
}

async function loadWeather() {
  const place = snap().place;
  if (!place) return;
  wx = wx || cachedWeather(place);
  try { wx = await getWeather(place); render(); } catch { /* keep the last one */ }
}

async function keepAwake() {
  try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
}

render();
loadWeather();
loadFeed();
setInterval(loadFeed, 2 * 60000);
setInterval(() => { updateShow(); render(); }, 30000);
document.body.append(showEl);
if (feed) { updateShow(); restartPhotos(); }
setInterval(async () => { try { if (compareVersions(await latestVersion(), VERSION) > 0) { try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* fine */ } location.reload(); } } catch { /* offline */ } }, 60 * 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); loadFeed(); } });
window.addEventListener('hashchange', () => location.reload());
keepAwake();
