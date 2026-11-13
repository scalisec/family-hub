// Family Hub app (phones and tablet). Everything on screen comes from this device's copy of the data,
// so taps answer instantly; sync.js saves to Drive in the background.
import { h, icon, sheet, closeSheet, toast, field, segmented, haptic } from './ui.js';
import * as store from './store.js';
import * as dates from './dates.js';
import { parse, splitItems } from './parse.js';
import { getWeather, cachedWeather, findPlace, wxIcon } from './weather.js';
import { connect, disconnect, isConnected, wasConnected, accountEmail, setAccountEmail, gjson, onChange as onGoogle } from './google.js';
import { folderLink } from './drive.js';
import { wallLink, relay } from './relay.js';
import { prepare, isImage } from './photos.js';
import * as sync from './sync.js';
import { VERSION, RELEASES, latestVersion, compareVersions, releaseDate } from './version.js';
import { BASE_THEMES, SEASONAL_THEMES, TEAM_THEMES, SWATCHES, AUTO, seasonFor, seasonCalendar, gameDayTheme } from './themes.js';

const { state } = sync;
const ui = {
  tab: sessionStorage.getItem('fh.tab') || 'today',
  meals: 'plan', mealsWeek: 0, lists: 'groceries', more: null, weekPart: 0,
  todoWho: 'all', recipeSearch: '', weather: null, connecting: false, stale: false, scroll: {},
};
const TABS = [['today', 'Today'], ['week', 'Week'], ['meals', 'Meals'], ['lists', 'Lists'], ['more', 'More']];
const $ = (sel) => document.querySelector(sel);
const D = () => state.data;
const change = sync.change;

/* ---------- shared bits ---------- */

const peopleList = () => store.people(D());
function person(id) { return id && id !== 'family' ? store.get(D(), 'people', id) : null; }
function meId() { return store.setting(D(), 'me', '') || (peopleList().find((p) => p.role === 'adult') || {}).id || ''; }

function tag(personId) {
  const p = person(personId);
  if (!p) return h('span', { class: 'ptag fam', title: 'Family' }, 'F');
  return h('span', { class: 'ptag', style: { borderColor: p.color, color: p.color }, title: p.name }, store.initial(p, peopleList()));
}
function whoName(id) { const p = person(id); return p ? p.name : 'Family'; }
const first = (p) => String((p && p.name) || '').trim().split(/\s+/)[0];
function empty(text, action) { return h('div', { class: 'empty' }, h('p', null, text), action || null); }
function card(title, body, extra) {
  return h('section', { class: 'card' }, title ? h('div', { class: 'card-head' }, h('h3', null, title), extra || null) : null, body);
}
function row(attrs, ...kids) { return h('button', { class: 'row', type: 'button', ...attrs }, ...kids); }

function mealText(m) {
  if (!m) return '';
  const r = m.recipe ? store.get(D(), 'recipes', m.recipe) : null;
  return r ? r.name : (m.text || '');
}
function events() { return (state.feed && state.feed.events) || []; }
function eventsOn(day) {
  const a = dates.startOfDay(day).getTime();
  const b = a + dates.DAY;
  return events().filter((e) => e.start < b && e.end > a);
}

/* ---------- frame ---------- */

function applyTheme() {
  const theme = store.currentTheme(D(), new Date(), events());
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('fh.themeNow', theme); } catch { /* fine */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#EEF3F9');
}

function statusChip() {
  const connected = isConnected();
  let label = 'Saved';
  let cls = 'ok';
  if (!connected) { label = sync.isDirty() ? 'Not saved yet' : 'Connect'; cls = 'warn'; }
  else if (state.status === 'saving') { label = 'Saving'; cls = 'busy'; }
  else if (state.status === 'offline') { label = 'Offline'; cls = 'warn'; }
  else if (state.status === 'error') { label = 'Problem saving'; cls = 'bad'; }
  else if (sync.isDirty()) { label = 'Saving'; cls = 'busy'; }
  return h('button', { class: `status ${cls}`, onclick: () => (connected ? statusSheet() : doConnect()) },
    h('span', { class: 'status-dot' }), label);
}

function statusSheet() {
  const f = state.feed;
  sheet('Sync', h('div', { class: 'stack' },
    h('p', null, state.status === 'error' ? `Last save had a problem: ${state.error}` : 'Everything you change saves to your Google Drive in a second or two. Other phones see it within about 30 seconds.'),
    h('p', { class: 'muted' }, `Calendars last read ${f && f.updated ? dates.time(f.updated) : 'not yet'}. They refresh every 15 minutes.`),
    f && f.errors && f.errors.length ? h('p', { class: 'warn-text' }, `Calendar problems: ${f.errors.join('; ')}`) : null,
    state.relayError ? h('p', { class: 'warn-text' }, `Helper: ${state.relayError}`) : null,
  ), { actions: [
    h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { await sync.refreshFeed({ sync: true }); toast('Calendars refreshed'); } catch (err) { toast(err.message); } closeSheet(); } }, 'Refresh calendars now'),
    h('a', { class: 'btn ghost', href: folderLink(), target: '_blank', rel: 'noopener' }, 'Open in Drive'),
  ] });
}

function header() {
  const title = ui.tab === 'today' ? 'Family Hub' : TABS.find(([k]) => k === ui.tab)[1];
  return h('header', { class: 'top' },
    h('div', { class: 'top-title' }, ui.tab === 'today' ? (teamLogo() ? h('img', { class: 'logo team', src: teamLogo(), alt: '' }) : h('span', { class: 'logo' }, icon('home'))) : null, h('h1', null, title)),
    statusChip());
}

function tabbar() {
  return h('nav', { class: 'tabbar', 'aria-label': 'Main' }, TABS.map(([key, label]) => h('button', {
    class: ui.tab === key ? 'on' : '', 'aria-current': ui.tab === key ? 'page' : null,
    onclick: () => go(key),
  }, icon(key), h('span', null, label))));
}

function go(tab) {
  if (tab === ui.tab) {
    if (tab === 'more' && ui.more) { ui.more = null; render(); }
    else $('#main')?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  haptic();
  ui.scroll[ui.tab] = $('#main')?.scrollTop || 0;
  ui.tab = tab;
  sessionStorage.setItem('fh.tab', tab);
  render({ animate: true });
}

function render({ animate = false } = {}) {
  applyTheme();
  const root = $('#app');
  const main = h('main', { id: 'main', class: animate ? 'enter' : '' }, screen());
  const banner = !isConnected() && !ui.connecting ? connectBanner() : null;
  const deco = hasDeco() ? h('div', { class: 'deco-band', 'aria-hidden': 'true' }) : null;
  root.replaceChildren(...[header(), deco, banner, main, fab(), tabbar()].filter(Boolean));
  const y = ui.scroll[ui.tab] || 0;
  if (y) main.scrollTop = y;
  ui.stale = false;
}

// Re-draw after background changes, but never while someone is typing.
function refresh() {
  const active = document.activeElement;
  if (active && $('#main')?.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) { ui.stale = true; return; }
  if (document.querySelector('.sheet-wrap')) { ui.stale = true; applyTheme(); const top = $('header.top'); if (top) top.replaceWith(header()); return; }
  ui.scroll[ui.tab] = $('#main')?.scrollTop || 0;
  render();
}

function screen() {
  switch (ui.tab) {
    case 'week': return weekScreen();
    case 'meals': return mealsScreen();
    case 'lists': return listsScreen();
    case 'more': return moreScreen();
    default: return todayScreen();
  }
}

function teamLogo(theme = store.currentTheme(D(), new Date(), events())) {
  return (store.setting(D(), 'teamLogos', {}) || {})[theme] || '';
}

// Logo for an event on a team's calendar (shown next to games in Next up).
function eventLogo(e) {
  const t = store.setting(D(), 'teamThemes', null);
  const team = t && (t.list || []).find((x) => x.calendarId === e.cal);
  return team ? (store.setting(D(), 'teamLogos', {}) || {})[team.theme] || '' : '';
}

// Shrinks a logo to 256 px and keeps transparent backgrounds.
async function logoData(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/png');
  if (url.length > 150000) url = c.toDataURL('image/webp', 0.9);
  return url;
}

function hasDeco() { const t = store.currentTheme(D(), new Date(), events()); return SEASONAL_THEMES.includes(t) || TEAM_THEMES.includes(t) || t === 'Christmas'; }

function connectBanner() {
  return h('div', { class: 'banner' },
    h('div', null, h('strong', null, wasConnected() ? 'Reconnect to Google' : 'Connect your Google account'),
      h('div', { class: 'muted small' }, wasConnected() ? 'Google sign-ins last about an hour. Your changes are kept on this phone until then.' : 'Family Hub keeps everything in a folder in your Google Drive.')),
    h('button', { class: 'btn small', onclick: doConnect }, icon('google'), 'Connect'));
}

async function doConnect() {
  ui.connecting = true;
  render();
  try {
    await connect();
    try {
      const me = await gjson('https://www.googleapis.com/oauth2/v3/userinfo');
      setAccountEmail(me.email || '');
    } catch { /* fine */ }
    toast('Connected');
    await sync.load({ importOld: sync.importOldVersion });
  } catch (err) {
    toast(err.message, { ms: 6000 });
  } finally {
    ui.connecting = false;
    render();
  }
}

/* ---------- Say or type ---------- */

function fab() {
  return h('button', { class: 'fab', 'aria-label': 'Say or type', onclick: () => sayOrType() }, icon('plus'));
}

function sayBar() {
  const input = h('input', { type: 'text', placeholder: 'Say or type: "add milk and eggs"', 'aria-label': 'Say or type', enterkeyhint: 'done', autocomplete: 'off' });
  const go2 = () => { const v = input.value; input.value = ''; input.blur(); handleSaid(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go2(); });
  return h('div', { class: 'saybar' }, icon('plus', 'lead'), input,
    micButton((text) => { input.value = text; go2(); }),
  );
}

function micButton(onText) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return null;
  const btn = h('button', { class: 'icon-btn mic', type: 'button', 'aria-label': 'Speak' }, icon('mic'));
  btn.addEventListener('click', () => {
    const rec = new Rec();
    rec.lang = 'en-CA';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    btn.classList.add('listening');
    rec.onresult = (e) => { const t = e.results[0][0].transcript; if (t) onText(t); };
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Allow the microphone for this site to use voice.' : "Didn't catch that. Try again."); };
    rec.onend = () => btn.classList.remove('listening');
    try { rec.start(); haptic(); } catch { btn.classList.remove('listening'); }
  });
  return btn;
}

function sayOrType(prefill = '') {
  const input = h('input', { type: 'text', value: prefill, placeholder: 'Add milk and eggs', autofocus: true, enterkeyhint: 'done', autocomplete: 'off' });
  const preview = h('div', { class: 'preview' });
  const update = () => { preview.replaceChildren(describe(parse(input.value, peopleList(), meId()))); };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { closeSheet(); handleSaid(input.value); } });
  update();
  sheet('Say or type', h('div', { class: 'stack' },
    h('div', { class: 'saybar big' }, input, micButton((t) => { input.value = t; update(); setTimeout(() => { closeSheet(); handleSaid(t); }, 450); })),
    preview,
    h('div', { class: 'examples muted small' },
      h('div', null, 'Try:'),
      ['add apples, yogurt and bread', `to-do for ${(store.kids(D())[0] || { name: 'Sam' }).name} sharpen skates by Friday`, 'remind me to book the dentist tomorrow']
        .map((t) => h('button', { class: 'chip', onclick: () => { input.value = t; update(); input.focus(); } }, t))),
  ), { actions: [h('button', { class: 'btn', onclick: () => { closeSheet(); handleSaid(input.value); } }, 'Add')] });
}

function describe(r) {
  if (r.kind === 'grocery') return h('div', { class: 'pv' }, icon('cart'), h('span', null, `Groceries: ${r.items.join(', ')}`));
  if (r.kind === 'todo') return h('div', { class: 'pv' }, icon('lists'), h('span', null, `To-do for ${whoName(r.who)}: ${r.text}${r.due ? ` (${dates.dueLabel(r.due)})` : ''}`));
  if (r.kind === 'unknown') return h('div', { class: 'pv muted' }, icon('info'), h('span', null, "You'll pick the list"));
  return h('div', { class: 'pv muted' }, '');
}

function handleSaid(text) {
  const r = parse(text, peopleList(), meId());
  if (r.kind === 'empty') return;
  if (r.kind === 'grocery') { addGroceries(r.items); return; }
  if (r.kind === 'todo') { addTodo(r.text, r.who, r.due); return; }
  sheet('Add to which list?', h('div', { class: 'stack' }, h('p', { class: 'quoted' }, r.text)), { actions: [
    h('button', { class: 'btn', onclick: () => { closeSheet(); addGroceries(splitItems(r.text)); } }, icon('cart'), 'Groceries'),
    h('button', { class: 'btn', onclick: () => { closeSheet(); addTodo(r.text, 'family', ''); } }, icon('lists'), 'To-do'),
  ] });
}

function addGroceries(items) {
  const have = new Set(store.live(D(), 'groceries').filter((g) => !g.done).map((g) => g.text.toLowerCase()));
  const fresh = items.filter((i) => !have.has(i.toLowerCase()));
  if (!fresh.length) { toast('Already on the list'); return; }
  let added = [];
  change((d) => { let x = d; for (const text of fresh) { const id = store.newId(); added.push(id); x = store.put(x, 'groceries', { id, text, done: false }); } return x; });
  haptic();
  toast(`Added to groceries: ${fresh.join(', ')}`, { action: 'Undo', onAction: () => change((d) => added.reduce((x, id) => store.remove(x, 'groceries', id), d)) });
}

function addTodo(text, who, due) {
  const id = store.newId();
  change((d) => store.put(d, 'todos', { id, text, who: who || 'family', due: due || '', done: false }));
  haptic();
  toast(`To-do for ${whoName(who)}${due ? `, ${dates.dueLabel(due).toLowerCase()}` : ''}`, { action: 'Undo', onAction: () => change((d) => store.remove(d, 'todos', id)) });
}

/* ---------- Today ---------- */

function todayScreen() {
  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return h('div', { class: 'screen today' },
    h('div', { class: 'hero' },
      h('div', null, h('div', { class: 'eyebrow' }, hello), h('div', { class: 'hero-date' }, dates.longDate(now))),
      weatherBlock()),
    sayBar(),
    h('div', { class: 'grid' },
      h('div', { class: 'col' }, nextUpCard(), todayEventsCard()),
      h('div', { class: 'col' }, mealsTodayCard(), todosTodayCard(), dailyCard())));
}

function weatherBlock() {
  const place = store.setting(D(), 'place', null);
  if (!place) return h('button', { class: 'wx-mini muted', onclick: () => { ui.tab = 'more'; ui.more = 'home'; render({ animate: true }); } }, icon('cloud'), 'Set weather location');
  const wx = ui.weather || cachedWeather(place);
  if (!wx) return h('div', { class: 'wx-mini muted' }, icon('cloud'), 'Weather');
  return h('button', { class: 'wx-mini', onclick: () => weatherSheet(wx, place) },
    icon(wxIcon(wx.code), 'wx-ic'),
    h('div', null, h('div', { class: 'wx-temp' }, `${wx.temp}°`), h('div', { class: 'small muted' }, `Feels ${wx.feels}°`)),
    h('div', { class: 'wear' }, wx.wear));
}

function weatherSheet(wx, place) {
  sheet(place.name || 'Weather', h('div', { class: 'stack' },
    h('div', { class: 'wx-now' }, icon(wxIcon(wx.code), 'wx-ic big'), h('div', null, h('div', { class: 'wx-temp big' }, `${wx.temp}°`), h('div', { class: 'muted' }, `${wx.label}, feels like ${wx.feels}°, wind ${wx.wind} km/h`))),
    h('p', { class: 'wear big' }, wx.wear),
    h('div', { class: 'wx-days' }, wx.days.map((d) => h('div', { class: 'wx-day' },
      h('div', { class: 'small muted' }, dates.dayLabel(dates.fromKey(d.date)).slice(0, 3)),
      icon(wxIcon(d.code)), h('div', { class: 'strong' }, `${d.hi}°`), h('div', { class: 'small muted' }, `${d.lo}°`),
      d.rain >= 30 ? h('div', { class: 'small rain' }, `${d.rain}%`) : null))),
    h('p', { class: 'muted small' }, 'Weather from Open-Meteo.')));
}

function nextUpCard() {
  const now = Date.now();
  const list = ((state.feed && state.feed.nextUp) || []).filter((e) => e.start > now).slice(0, 3);
  let body;
  if (!state.feed) body = empty(isConnected() ? 'Reading your calendars...' : 'Connect Google to see what\'s next.');
  else if (!store.live(D(), 'feeds').length) body = empty('Pick the calendars to show.', h('button', { class: 'btn small', onclick: () => openMore('calendars') }, 'Pick calendars'));
  else if (!list.length) body = empty('Nothing coming up.');
  else {
    body = h('div', { class: 'list' }, list.map((e) => {
      const leaveSoon = e.leave && e.leave - now < 45 * 60000;
      const why = [e.buffer ? `arrive ${e.buffer} min early` : '', e.drive != null ? `${e.drive} min drive` : ''].filter(Boolean).join(', ');
      return h('div', { class: 'nu' },
        h('span', { class: 'bar', style: { background: e.color || 'var(--accent)' } }),
        h('div', { class: 'nu-main' },
          h('div', { class: 'nu-title' }, eventLogo(e) ? h('img', { class: 'ev-logo', src: eventLogo(e), alt: '' }) : null, e.title, ' ', tag(e.person)),
          h('div', { class: 'muted small' }, `${dates.dayLabel(new Date(e.start))} ${dates.time(e.start)}`, e.location ? ` · ${e.location.split(',')[0]}` : ''),
          e.leave ? h('div', { class: `leave${leaveSoon ? ' soon' : ''}` }, icon('car'), `Leave by ${dates.time(e.leave)}`, h('span', { class: 'muted small' }, ` ${[dates.inLabel(e.leave), why].filter(Boolean).join(' \u00b7 ')}`))
            : e.arriveBy ? h('div', { class: 'leave' }, icon('clock'), `Be there by ${dates.time(e.arriveBy)}`) : null));
    }));
  }
  return card('Next up', body);
}

function eventRow(e) {
  return h('div', { class: 'ev' },
    h('span', { class: 'bar', style: { background: e.color || 'var(--accent)' } }),
    h('div', { class: 'ev-time' }, e.allDay ? 'All day' : dates.time(e.start)),
    h('div', { class: 'ev-title' }, e.title, e.location ? h('div', { class: 'muted small' }, e.location.split(',')[0]) : null),
    tag(e.person));
}

function todayEventsCard() {
  const list = eventsOn(new Date());
  return card('Today', list.length ? h('div', { class: 'list' }, list.map(eventRow)) : empty(state.feed ? 'Nothing on the calendar today.' : 'Calendars will show here.'),
    h('button', { class: 'link', onclick: () => go('week') }, 'Week', icon('chevron')));
}

function mealSlots(day) {
  const slots = [['dinner', 'Dinner']];
  if (!dates.isWeekend(day)) for (const k of store.kids(D())) slots.push([`lunch:${k.id}`, `${first(k)}'s lunch`, k]);
  return slots;
}

function mealsTodayCard() {
  const today = new Date();
  const key = dates.dateKey(today);
  const rows = mealSlots(today).map(([slot, label, kid]) => {
    const m = store.get(D(), 'meals', store.mealId(key, slot));
    const text = mealText(m);
    return row({ onclick: () => mealPicker(key, slot, label) },
      h('div', { class: 'row-label' }, kid ? tag(kid.id) : icon('meals'), h('span', { class: 'muted small' }, label)),
      h('div', { class: `row-value${text ? '' : ' placeholder'}` }, text || 'Plan it'), icon('chevron', 'tail'));
  });
  if (dates.isWeekend(today) && store.kids(D()).length) rows.push(h('div', { class: 'muted small pad' }, 'No school lunches today.'));
  return card('Meals today', h('div', { class: 'list' }, rows), h('button', { class: 'link', onclick: () => go('meals') }, 'Plan', icon('chevron')));
}

function todosTodayCard() {
  const today = dates.dateKey(new Date());
  const list = store.live(D(), 'todos').filter((t) => !t.done && (!t.due || t.due <= today)).sort(store.byDue).slice(0, 6);
  return card('To-dos', list.length ? h('div', { class: 'list' }, list.map(todoRow)) : empty('All done for today.'),
    h('button', { class: 'link', onclick: () => { ui.lists = 'todos'; go('lists'); } }, 'All', icon('chevron')));
}

function dailyCard() {
  const d = state.feed && state.feed.daily;
  if (!d) return null;
  return h('section', { class: 'card daily' },
    h('div', { class: 'daily-item' }, icon('smile'), h('div', null, h('div', { class: 'eyebrow' }, 'Joke of the day'), h('p', null, d.joke))),
    h('div', { class: 'daily-item' }, icon('quote'), h('div', null, h('div', { class: 'eyebrow' }, 'Quote of the day'), h('p', null, d.quote, d.author ? h('span', { class: 'muted' }, ` — ${d.author}`) : null),
      d.quoteCredit ? h('div', { class: 'credit' }, 'Inspirational quotes provided by ', h('a', { href: 'https://zenquotes.io/', target: '_blank', rel: 'noopener' }, 'ZenQuotes API')) : null)));
}

/* ---------- Week ---------- */

function weekScreen() {
  const start = dates.addDays(dates.startOfDay(), ui.weekPart * 7);
  const days = Array.from({ length: 7 }, (_, i) => dates.addDays(start, i));
  const ppl = peopleList();
  const filter = ui.weekWho || 'all';
  const show = (e) => filter === 'all' || e.person === filter || (filter === 'family' && !e.person);
  return h('div', { class: 'screen' },
    h('div', { class: 'toolbar' },
      segmented([[0, 'Next 7 days'], [1, 'Week after']], ui.weekPart, (v) => { ui.weekPart = v; render(); })),
    h('div', { class: 'chips' }, [['all', 'Everyone'], ...ppl.map((p) => [p.id, p.name])].map(([id, name]) => h('button', {
      class: `chip${filter === id ? ' on' : ''}`, onclick: () => { ui.weekWho = id; render(); },
    }, id !== 'all' ? h('span', { class: 'dot', style: { background: (person(id) || {}).color } }) : null, name))),
    !state.feed ? card(null, empty(isConnected() ? 'Reading your calendars...' : 'Connect Google to see your calendars.')) : null,
    days.map((day) => {
      const list = eventsOn(day).filter(show);
      const today = dates.dateKey(day) === dates.dateKey(new Date());
      const dinner = mealText(store.get(D(), 'meals', store.mealId(dates.dateKey(day), 'dinner')));
      return h('section', { class: `card day${today ? ' is-today' : ''}` },
        h('div', { class: 'day-head' },
          h('div', { class: 'day-num' }, String(day.getDate())),
          h('div', null, h('div', { class: 'strong' }, dates.dayLabel(day)), h('div', { class: 'muted small' }, day.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }))),
          dinner ? h('div', { class: 'day-dinner small muted' }, icon('meals'), dinner) : null),
        list.length ? h('div', { class: 'list' }, list.map(eventRow)) : h('div', { class: 'muted small pad' }, 'Free'));
    }));
}

/* ---------- Meals ---------- */

function mealsScreen() {
  return h('div', { class: 'screen' },
    h('div', { class: 'toolbar' }, segmented([['plan', 'Plan'], ['recipes', 'Recipes']], ui.meals, (v) => { ui.meals = v; render(); })),
    ui.meals === 'recipes' ? recipesView() : planView());
}

function planView() {
  const start = dates.addDays(dates.startOfDay(), ui.mealsWeek * 7);
  const days = Array.from({ length: 7 }, (_, i) => dates.addDays(start, i));
  return h('div', null,
    h('div', { class: 'toolbar' }, segmented([[0, 'Next 7 days'], [1, 'Week after']], ui.mealsWeek, (v) => { ui.mealsWeek = v; render(); }),
      h('button', { class: 'btn ghost small', onclick: () => groceriesFromPlan(days) }, icon('cart'), 'Shop for it')),
    !store.kids(D()).length ? h('p', { class: 'muted small pad' }, 'Add the kids in More > People to plan school lunches.') : null,
    days.map((day) => {
      const key = dates.dateKey(day);
      return h('section', { class: 'card meal-day' },
        h('div', { class: 'card-head' }, h('h3', null, `${dates.dayLabel(day)}`), h('span', { class: 'muted small' }, dates.shortDate(day))),
        h('div', { class: 'list' }, mealSlots(day).map(([slot, label, kid]) => {
          const text = mealText(store.get(D(), 'meals', store.mealId(key, slot)));
          return row({ onclick: () => mealPicker(key, slot, label) },
            h('div', { class: 'row-label' }, kid ? tag(kid.id) : icon('meals'), h('span', { class: 'muted small' }, kid ? 'Lunch' : label)),
            h('div', { class: `row-value${text ? '' : ' placeholder'}` }, text || 'Add'), icon('chevron', 'tail'));
        }), dates.isWeekend(day) && store.kids(D()).length ? h('div', { class: 'muted small pad' }, 'No school') : null));
    }));
}

function groceriesFromPlan(days) {
  const keys = new Set(days.map(dates.dateKey));
  const items = [];
  for (const m of store.live(D(), 'meals')) {
    if (!keys.has(m.date) || !m.recipe) continue;
    const r = store.get(D(), 'recipes', m.recipe);
    if (r) items.push(...(r.ingredients || []));
  }
  if (!items.length) { toast('No recipes with ingredients planned for these days.'); return; }
  pickIngredients([...new Set(items)]);
}

function pickIngredients(items) {
  const boxes = items.map((t) => ({ t, on: true }));
  sheet('Add to groceries', h('div', { class: 'list' }, boxes.map((b) => {
    const btn = row({ class: 'row check-row', onclick: () => { b.on = !b.on; btn.classList.toggle('on', b.on); } },
      h('span', { class: 'check' }, icon('check')), h('div', { class: 'row-value' }, b.t));
    btn.classList.add('on');
    return btn;
  })), { actions: [h('button', { class: 'btn', onclick: () => { closeSheet(); addGroceries(boxes.filter((b) => b.on).map((b) => b.t)); } }, 'Add ticked')] });
}

function mealPicker(date, slot, label) {
  const id = store.mealId(date, slot);
  const current = store.get(D(), 'meals', id);
  const lunch = slot.startsWith('lunch');
  const recipes = store.live(D(), 'recipes').filter((r) => r.kind === 'any' || !r.kind || r.kind === (lunch ? 'lunch' : 'dinner')).sort((a, b) => a.name.localeCompare(b.name));
  const search = h('input', { type: 'search', placeholder: lunch ? 'Search lunches or type one' : 'Search recipes or type a meal', autocomplete: 'off' });
  const listEl = h('div', { class: 'list' });
  const set = (rec) => { change((d) => store.put(d, 'meals', { id, date, slot, ...rec })); closeSheet(); haptic(); };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const hits = recipes.filter((r) => !q || r.name.toLowerCase().includes(q));
    listEl.replaceChildren(
      q && !hits.some((r) => r.name.toLowerCase() === q) ? row({ onclick: () => set({ recipe: '', text: search.value.trim() }) }, icon('plus'), h('div', { class: 'row-value' }, `Use "${search.value.trim()}"`)) : null,
      ...hits.map((r) => row({ class: `row${current && current.recipe === r.id ? ' on' : ''}`, onclick: () => set({ recipe: r.id, text: '' }) }, icon('book'), h('div', { class: 'row-value' }, r.name))),
      !hits.length && !q ? h('div', { class: 'muted small pad' }, 'No recipes yet. Type a meal above, or add recipes in Meals > Recipes.') : null);
  };
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) set({ recipe: '', text: search.value.trim() }); });
  draw();
  sheet(`${label}, ${dates.dayLabel(dates.fromKey(date))}`, h('div', { class: 'stack' }, search, listEl), {
    actions: current ? [h('button', { class: 'btn ghost', onclick: () => { change((d) => store.remove(d, 'meals', id)); closeSheet(); } }, 'Clear')] : null,
  });
}

function recipesView() {
  const all = store.live(D(), 'recipes').sort((a, b) => a.name.localeCompare(b.name));
  const search = h('input', { type: 'search', placeholder: 'Search recipes', value: ui.recipeSearch, autocomplete: 'off' });
  const listEl = h('div', { class: 'list' });
  const draw = () => {
    ui.recipeSearch = search.value;
    const q = search.value.trim().toLowerCase();
    const hits = all.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.ingredients || []).some((i) => i.toLowerCase().includes(q)));
    listEl.replaceChildren(...hits.map((r) => row({ onclick: () => recipeSheet(r.id) },
      h('div', { class: 'row-value' }, r.name, h('div', { class: 'muted small' }, [r.kind === 'lunch' ? 'Lunch' : r.kind === 'dinner' ? 'Dinner' : 'Any meal', (r.ingredients || []).length ? `${r.ingredients.length} ingredients` : ''].filter(Boolean).join(' · '))),
      icon('chevron', 'tail'))));
    if (!hits.length) listEl.append(empty(all.length ? 'No matches.' : 'Your recipe library is empty.'));
  };
  search.addEventListener('input', draw);
  draw();
  return h('div', null,
    h('div', { class: 'toolbar' }, search, h('button', { class: 'btn small', onclick: () => recipeEdit() }, icon('plus'), 'Recipe')),
    card(null, listEl));
}

function recipeSheet(id) {
  const r = store.get(D(), 'recipes', id);
  if (!r) return;
  sheet(r.name, h('div', { class: 'stack' },
    h('div', { class: 'muted small' }, r.kind === 'lunch' ? 'Lunch' : r.kind === 'dinner' ? 'Dinner' : 'Any meal'),
    (r.ingredients || []).length ? h('div', null, h('div', { class: 'eyebrow' }, 'Ingredients'), h('ul', { class: 'ingredients' }, r.ingredients.map((i) => h('li', null, i)))) : null,
    r.notes ? h('div', null, h('div', { class: 'eyebrow' }, 'Notes'), h('p', { class: 'pre' }, r.notes)) : null,
    r.link ? h('a', { class: 'btn ghost', href: r.link, target: '_blank', rel: 'noopener' }, icon('link'), 'Open recipe') : null,
  ), { actions: [
    (r.ingredients || []).length ? h('button', { class: 'btn', onclick: () => { closeSheet(); pickIngredients(r.ingredients); } }, icon('cart'), 'Groceries') : null,
    h('button', { class: 'btn ghost', onclick: () => recipeEdit(r.id) }, icon('edit'), 'Edit'),
  ] });
}

function recipeEdit(id) {
  const r = id ? store.get(D(), 'recipes', id) : { name: '', kind: 'dinner', ingredients: [], notes: '', link: '' };
  const name = h('input', { type: 'text', value: r.name, placeholder: 'Chicken tacos', autofocus: !id });
  const kind = h('select', null, [['dinner', 'Dinner'], ['lunch', 'Lunch'], ['any', 'Any meal']].map(([v, l]) => h('option', { value: v, selected: (r.kind || 'any') === v }, l)));
  const ing = h('textarea', { rows: '6', placeholder: 'One per line' }, (r.ingredients || []).join('\n'));
  const notes = h('textarea', { rows: '4', placeholder: 'Steps or tips' }, r.notes || '');
  const link = h('input', { type: 'url', value: r.link || '', placeholder: 'https://' });
  const save = () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    const url = link.value.trim();
    change((d) => store.put(d, 'recipes', { id: id || undefined, name: n.slice(0, 80), kind: kind.value,
      ingredients: ing.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 60),
      notes: notes.value.trim().slice(0, 4000), link: /^https?:\/\//i.test(url) ? url : '' }));
    closeSheet();
    toast(id ? 'Recipe saved' : 'Recipe added');
  };
  sheet(id ? 'Edit recipe' : 'New recipe', h('div', { class: 'stack' },
    field('Name', name), field('For', kind), field('Ingredients', ing, 'One per line. You can send them to groceries.'), field('Notes', notes), field('Link (optional)', link)),
  { actions: [
    id ? h('button', { class: 'btn ghost danger', onclick: () => { change((d) => store.remove(d, 'recipes', id)); closeSheet(); toast('Recipe deleted'); } }, icon('trash'), 'Delete') : null,
    h('button', { class: 'btn', onclick: save }, 'Save'),
  ] });
}

/* ---------- Lists ---------- */

function listsScreen() {
  const openG = store.live(D(), 'groceries').filter((g) => !g.done).length;
  const openT = store.live(D(), 'todos').filter((t) => !t.done).length;
  return h('div', { class: 'screen' },
    h('div', { class: 'toolbar' }, segmented([['groceries', `Groceries${openG ? ` ${openG}` : ''}`], ['todos', `To-dos${openT ? ` ${openT}` : ''}`]], ui.lists, (v) => { ui.lists = v; render(); })),
    ui.lists === 'todos' ? todosView() : groceriesView());
}

function addInput(placeholder, onAdd) {
  const input = h('input', { type: 'text', placeholder, enterkeyhint: 'done', autocomplete: 'off' });
  const submit = () => { const v = input.value.trim(); if (!v) return; input.value = ''; onAdd(v); input.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return h('div', { class: 'saybar' }, icon('plus', 'lead'), input, micButton((t) => onAdd(t)), h('button', { class: 'btn small', onclick: submit }, 'Add'));
}

function groceriesView() {
  const all = store.live(D(), 'groceries');
  const open = all.filter((g) => !g.done).sort((a, b) => a.u - b.u);
  const done = all.filter((g) => g.done).sort((a, b) => b.u - a.u);
  return h('div', null,
    addInput('Add items: "bananas, cheese"', (v) => {
      const r = parse(v, peopleList(), meId());
      addGroceries(r.kind === 'grocery' ? r.items : splitItems(v));
    }),
    card(null, open.length ? h('div', { class: 'list' }, open.map(groceryRow)) : empty('The list is empty.')),
    open.length ? h('button', { class: 'btn instacart', onclick: () => shopInstacart(open) }, icon('cart'), 'Shop on Instacart') : null,
    done.length ? card(`In the cart (${done.length})`, h('div', { class: 'list' }, done.map(groceryRow)),
      h('button', { class: 'link', onclick: () => { const ids = done.map((g) => g.id); change((d) => ids.reduce((x, id) => store.remove(x, 'groceries', id), d)); toast('Cleared'); } }, 'Clear')) : null);
}

async function shopInstacart(items) {
  const names = items.map((g) => g.text);
  // Open the window straight away (inside the tap) so the browser doesn't block it.
  const win = window.open('', '_blank');
  let url = '';
  try {
    if (isConnected()) url = (await relay('instacart', { items: names, title: `Family Hub groceries, ${dates.shortDate(new Date())}` })).url;
  } catch (err) { toast(err.message, { ms: 5000 }); }
  if (!url) {
    try { await navigator.clipboard.writeText(names.join('\n')); } catch { /* fine */ }
    url = `https://www.instacart.ca/store/s?k=${encodeURIComponent(names[0])}`;
    toast('List copied. Search each item in Instacart.', { ms: 5000 });
  }
  if (win) win.location.href = url; else location.href = url;
  setTimeout(() => sheet('Back from Instacart?', h('p', null, 'Move everything you ordered to "In the cart"?'), { actions: [
    h('button', { class: 'btn ghost', onclick: () => closeSheet() }, 'Not yet'),
    h('button', { class: 'btn', onclick: () => { const ids = items.map((g) => g.id); change((d) => ids.reduce((x, id) => store.put(x, 'groceries', { id, done: true }), d)); closeSheet(); toast('Moved to the cart'); } }, 'Yes, all'),
  ] }), 1500);
}

function groceryRow(g) {
  const el = h('div', { class: `item${g.done ? ' done' : ''}` },
    h('button', { class: 'check', 'aria-label': g.done ? 'Put back' : 'Got it', onclick: () => { haptic(); el.classList.toggle('done'); setTimeout(() => change((d) => store.put(d, 'groceries', { id: g.id, done: !g.done })), 180); } }, icon('check')),
    h('div', { class: 'item-text' }, g.text),
    h('button', { class: 'icon-btn faint', 'aria-label': 'Remove', onclick: () => { change((d) => store.remove(d, 'groceries', g.id)); toast(`Removed ${g.text}`, { action: 'Undo', onAction: () => change((d) => store.put(d, 'groceries', { ...g, u: undefined })) }); } }, icon('x')));
  return el;
}

function todosView() {
  const ppl = peopleList();
  const all = store.live(D(), 'todos');
  const pick = ui.todoWho;
  const mine = (t) => pick === 'all' || (t.who || 'family') === pick;
  const open = all.filter((t) => !t.done && mine(t)).sort(store.byDue);
  const done = all.filter((t) => t.done && mine(t)).sort((a, b) => b.u - a.u);
  return h('div', null,
    h('div', { class: 'chips' }, [['all', 'All'], ['family', 'Family'], ...ppl.map((p) => [p.id, p.name])].map(([id, name]) => h('button', {
      class: `chip${pick === id ? ' on' : ''}`, onclick: () => { ui.todoWho = id; render(); },
    }, id !== 'all' ? tag(id) : null, name))),
    addInput(pick === 'all' || pick === 'family' ? 'Add a to-do: "Sam sharpen skates Friday"' : `Add a to-do for ${whoName(pick)}`, (v) => {
      const r = parse(/^(to-?do|task|remind|chore)/i.test(v) ? v : `to-do ${pick !== 'all' && pick !== 'family' ? `for ${whoName(pick)} ` : ''}${v}`, ppl, meId());
      if (r.kind === 'todo') {
        // "Sam sharpen skates" typed without "for": pick up a leading name.
        let { text, who } = r;
        if (who === 'family') { const p = ppl.find((x) => new RegExp(`^${x.name}\\b`, 'i').test(text)); if (p) { who = p.id; text = text.replace(new RegExp(`^${p.name}\\s*`, 'i'), ''); text = text[0].toUpperCase() + text.slice(1); } }
        addTodo(text, who, r.due);
      } else addTodo(v, pick === 'all' ? 'family' : pick, '');
    }),
    card(null, open.length ? h('div', { class: 'list' }, open.map(todoRow)) : empty('Nothing to do. Nice.')),
    done.length ? card(`Done (${done.length})`, h('div', { class: 'list' }, done.slice(0, 30).map(todoRow)),
      h('button', { class: 'link', onclick: () => { const ids = done.map((t) => t.id); change((d) => ids.reduce((x, id) => store.remove(x, 'todos', id), d)); toast('Cleared'); } }, 'Clear')) : null);
}

function todoRow(t) {
  const today = dates.dateKey(new Date());
  const due = t.due ? dates.dueLabel(t.due) : '';
  const el = h('div', { class: `item${t.done ? ' done' : ''}` },
    h('button', { class: 'check', 'aria-label': t.done ? 'Not done' : 'Done', onclick: () => { haptic(); el.classList.toggle('done'); setTimeout(() => change((d) => store.put(d, 'todos', { id: t.id, done: !t.done })), 180); } }, icon('check')),
    h('button', { class: 'item-text plain', onclick: () => todoEdit(t.id) }, t.text,
      due ? h('span', { class: `due${t.due < today && !t.done ? ' late' : ''}` }, due) : null),
    tag(t.who));
  return el;
}

function todoEdit(id) {
  const t = store.get(D(), 'todos', id);
  if (!t) return;
  const text = h('input', { type: 'text', value: t.text });
  const who = h('select', null, [['family', 'Family'], ...peopleList().map((p) => [p.id, p.name])].map(([v, l]) => h('option', { value: v, selected: (t.who || 'family') === v }, l)));
  const due = h('input', { type: 'date', value: t.due || '' });
  sheet('To-do', h('div', { class: 'stack' }, field('What', text), field('Who', who), field('Due', due)), { actions: [
    h('button', { class: 'btn ghost danger', onclick: () => { change((d) => store.remove(d, 'todos', id)); closeSheet(); toast('Deleted', { action: 'Undo', onAction: () => change((d) => store.put(d, 'todos', { ...t, u: undefined })) }); } }, icon('trash'), 'Delete'),
    h('button', { class: 'btn', onclick: () => { change((d) => store.put(d, 'todos', { id, text: text.value.trim() || t.text, who: who.value, due: due.value })); closeSheet(); } }, 'Save'),
  ] });
}

/* ---------- More ---------- */

const MORE = [
  ['themes', 'Themes', 'palette'],
  ['wall', 'Wall screen', 'tv'],
  ['photos', 'Photos and slideshow', 'image'],
  ['people', 'People', 'people'],
  ['calendars', 'Calendars', 'calendar'],
  ['rules', 'Arrival times', 'clock'],
  ['home', 'Home and weather', 'home'],
  ['account', 'Google account', 'google'],
  ['about', 'About and updates', 'info'],
];

function openMore(page) { ui.tab = 'more'; ui.more = page; sessionStorage.setItem('fh.tab', 'more'); render({ animate: true }); }

function moreScreen() {
  if (ui.more) {
    const [, title] = MORE.find(([k]) => k === ui.more) || [null, ''];
    return h('div', { class: 'screen sub' },
      h('button', { class: 'back', onclick: () => { ui.more = null; render({ animate: true }); } }, icon('back'), 'More'),
      h('h2', { class: 'page-title' }, title),
      morePage(ui.more));
  }
  return h('div', { class: 'screen' }, card(null, h('div', { class: 'list' }, MORE.map(([key, label, ic]) => row({ onclick: () => openMore(key) },
    h('span', { class: 'menu-ic' }, icon(ic)), h('div', { class: 'row-value' }, label), icon('chevron', 'tail'))))),
  h('p', { class: 'muted small center' }, `Family Hub ${VERSION}`));
}

function morePage(page) {
  switch (page) {
    case 'themes': return themesPage();
    case 'wall': return wallPage();
    case 'photos': return photosPage();
    case 'people': return peoplePage();
    case 'calendars': return calendarsPage();
    case 'rules': return rulesPage();
    case 'home': return homePage();
    case 'account': return accountPage();
    case 'about': return aboutPage();
    default: return null;
  }
}

function swatch(name) {
  const [a, b, c] = SWATCHES[name] || SWATCHES.Rink;
  return h('div', { class: 'swatch' }, h('span', { style: { background: a } }), h('span', { style: { background: b } }), h('span', { style: { background: c } }));
}

function themesPage() {
  const cur = store.setting(D(), 'theme', 'Rink');
  const base = store.setting(D(), 'themeBase', 'Rink');
  const season = seasonFor(new Date());
  const pick = (name) => { change((d) => store.setSetting(d, 'theme', name)); haptic(); };
  const tile = (name, note) => h('button', {
    class: `theme${cur === name ? ' on' : ''}`, 'aria-pressed': String(cur === name), onclick: () => pick(name),
  }, swatch(name), h('div', { class: 'strong' }, name), h('div', { class: 'small muted' }, cur === name ? 'In use' : note || ''));
  const autoOn = cur === AUTO;
  const baseSel = h('select', { 'aria-label': 'Theme between seasons' }, BASE_THEMES.filter((t) => t !== 'Christmas').map((t) => h('option', { value: t, selected: base === t }, t)));
  baseSel.addEventListener('change', () => change((d) => store.setSetting(d, 'themeBase', baseSel.value)));
  return h('div', { class: 'stack' },
    card(null, h('div', { class: 'stack' },
      toggleRow('Seasonal (auto)', autoOn, (on) => pick(on ? AUTO : store.currentTheme(D()))),
      h('p', { class: 'muted small' }, autoOn
        ? `Changes by itself through the year. Showing ${store.currentTheme(D(), new Date(), events())} now${season ? '' : ' (between seasons)'}.`
        : 'Turn on to have the theme follow the seasons and holidays.'),
      autoOn ? field('Between seasons, use', baseSel) : null,
      autoOn ? h('details', { class: 'small' }, h('summary', null, 'When each season shows'),
        h('div', { class: 'list' }, seasonCalendar().map(([n, when]) => h('div', { class: 'cal-row' }, h('span', { class: 'strong' }, n), h('span', { class: 'muted' }, when))))) : null)),
    h('h3', { class: 'section-title' }, 'Everyday'),
    h('div', { class: 'themes' }, BASE_THEMES.map((n) => tile(n))),
    h('h3', { class: 'section-title' }, 'Seasonal packs'),
    h('div', { class: 'themes' }, SEASONAL_THEMES.map((n) => tile(n))),
    h('h3', { class: 'section-title' }, 'Team themes'),
    teamThemesCard(),
    h('div', { class: 'themes' }, TEAM_THEMES.map((n) => tile(n))));
}

function teamThemesCard() {
  const saved = store.setting(D(), 'teamThemes', null) || { on: false, list: [] };
  const feeds = store.live(D(), 'feeds').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const save = (patch) => change((d) => store.setSetting(d, 'teamThemes', { ...(store.setting(d, 'teamThemes', null) || { on: false, list: [] }), ...patch }));
  const calFor = (theme) => (saved.list.find((t) => t.theme === theme) || {}).calendarId || '';
  const pickers = TEAM_THEMES.map((theme) => {
    const sel = h('select', { 'aria-label': `${theme} calendar` }, [['', 'No calendar'], ...feeds.map((f) => [f.calendarId, f.name || 'Calendar'])].map(([v, l]) => h('option', { value: v, selected: calFor(theme) === v }, l)));
    sel.addEventListener('change', () => {
      const list = TEAM_THEMES.map((t) => ({ theme: t, calendarId: t === theme ? sel.value : calFor(t) })).filter((t) => t.calendarId);
      save({ list });
    });
    return field(`${theme} games come from`, sel);
  });
  const logos = store.setting(D(), 'teamLogos', {}) || {};
  const logoRows = TEAM_THEMES.map((theme) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      try {
        const url = await logoData(f);
        change((d) => store.setSetting(d, 'teamLogos', { ...(store.setting(d, 'teamLogos', {}) || {}), [theme]: url }));
        toast(`${theme} logo added`);
      } catch { toast("Couldn't open that image. Try a PNG or JPG."); }
    });
    return h('div', { class: 'logo-row' },
      logos[theme] ? h('img', { class: 'logo-prev', src: logos[theme], alt: `${theme} logo` }) : h('span', { class: 'logo-prev empty-logo' }, icon('image')),
      h('div', { class: 'row-value' }, `${theme} logo`, h('div', { class: 'muted small' }, logos[theme] ? 'Shown in the header and next to games' : 'None yet')),
      h('button', { class: 'btn ghost small', onclick: () => input.click() }, logos[theme] ? 'Replace' : 'Add'),
      logos[theme] ? h('button', { class: 'icon-btn faint', 'aria-label': `Remove ${theme} logo`, onclick: () => change((d) => { const x = { ...(store.setting(d, 'teamLogos', {}) || {}) }; delete x[theme]; return store.setSetting(d, 'teamLogos', x); }) }, icon('trash')) : null,
      input);
  });
  const today = gameDayTheme(events(), saved.list);
  return card(null, h('div', { class: 'stack' },
    toggleRow('Switch to the team theme on game days', Boolean(saved.on), (on) => save({ on })),
    h('p', { class: 'muted small' }, 'On a day with a game on that team\'s calendar, the app and the wall wear the team\'s colours. If both teams play, it shows whoever plays next. Practices don\'t count.'),
    saved.on ? h('div', { class: 'stack' }, pickers) : null,
    h('div', { class: 'list' }, logoRows),
    h('p', { class: 'muted small' }, 'Logos are kept in your Family Hub file in Drive, not in the app\'s public code. A PNG with a see-through background looks best.'),
    saved.on ? h('p', { class: 'small strong' }, today ? `Game day today: ${today}` : 'No team games today.') : null));
}

function wallPage() {
  const link = wallLink(state.wallKey);
  const lay = store.layout(D());
  const dim = store.setting(D(), 'dim', { from: '22:00', to: '06:00' });
  const from = h('input', { type: 'time', value: dim.from });
  const to = h('input', { type: 'time', value: dim.to });
  const saveDim = () => change((d) => store.setSetting(d, 'dim', { from: from.value || '22:00', to: to.value || '06:00' }));
  from.addEventListener('change', saveDim);
  to.addEventListener('change', saveDim);
  return h('div', { class: 'stack' },
    card('Wall link', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Open this link on the wall screen\'s browser and make it full screen. It shows everything but can\'t change anything, and it doesn\'t need a Google sign-in.'),
      link ? h('div', { class: 'linkbox' }, link) : h('p', { class: 'muted' }, isConnected() ? 'Getting the link...' : 'Connect Google to get the wall link.'),
      link ? h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener' }, icon('tv'), 'Open'),
        h('button', { class: 'btn ghost', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Couldn\'t copy. Press and hold the link instead.'); } } }, icon('copy'), 'Copy'),
        h('button', { class: 'btn ghost', onclick: () => confirmSheet('Make a new wall link?', 'The old link stops working straight away. You\'ll need to open the new one on the wall screen.', 'New link', async () => { try { await sync.rotateWallKey(); toast('New wall link ready'); } catch (err) { toast(err.message); } }) }, icon('sync'), 'New link')) : null)),
    card('What the wall shows', h('div', { class: 'list' }, store.TILES.map(([key, label]) => toggleRow(label, lay[key], (on) => change((d) => store.setSetting(d, 'layout', { ...store.layout(d), [key]: on })))))),
    card('Night dimming', h('div', { class: 'btn-row' }, field('Dim from', from), field('Until', to))));
}

/* ---------- Photos ---------- */

const photoState = { list: null, thumbs: {}, loading: false, queue: [], done: 0, failed: [], busy: false, selecting: false, picked: new Set() };

async function loadPhotos(force = false) {
  if (!isConnected() || photoState.loading || (photoState.list && !force)) return;
  photoState.loading = true;
  try {
    const r = await relay('photoList');
    photoState.list = r.photos.sort((a, b) => b.added - a.added);
    photoState.thumbs = r.thumbs || {};
  } catch (err) { photoState.error = err.message; }
  photoState.loading = false;
  if (ui.tab === 'more' && ui.more === 'photos') refresh();
}

function addPhotos(files) {
  const have = new Set((photoState.list || []).map((p) => p.key));
  const fresh = [...files].filter(isImage).filter((f) => !have.has(`${f.name}|${f.size}|${f.lastModified}`));
  const skipped = files.length - fresh.length;
  if (!fresh.length) { toast(skipped ? 'Those photos are already on the wall, or aren\'t photos.' : 'No photos picked.'); return; }
  photoState.queue.push(...fresh);
  if (skipped) toast(`${skipped} skipped (already added or not a photo)`);
  runQueue();
}

async function runQueue() {
  if (photoState.busy) return;
  photoState.busy = true;
  photoState.done = 0;
  photoState.failed = [];
  refreshPhotosPage();
  while (photoState.queue.length) {
    const file = photoState.queue.shift();
    try {
      const prepared = await prepare(file);
      const r = await relay('photoAdd', prepared);
      photoState.list = [r.photo, ...(photoState.list || []).filter((p) => p.id !== r.photo.id)];
      photoState.thumbs[r.photo.id] = prepared.thumb;
      photoState.done += 1;
    } catch (err) {
      photoState.failed.push(`${file.name}: ${err.message}`);
      if (err.code === 'not-connected') { photoState.queue = []; break; }
    }
    refreshPhotosPage();
  }
  photoState.busy = false;
  toast(`${photoState.done} photo${photoState.done === 1 ? '' : 's'} added${photoState.failed.length ? `, ${photoState.failed.length} didn't work` : ''}`);
  refreshPhotosPage();
}

function refreshPhotosPage() {
  if (ui.tab === 'more' && ui.more === 'photos' && !document.querySelector('.sheet-wrap')) {
    ui.scroll.more = $('#main')?.scrollTop || 0;
    render();
  }
}

function photosPage() {
  if (!photoState.list) loadPhotos();
  const ps = store.photoSettings(D());
  const setP = (patch) => change((d) => store.setSetting(d, 'photos', { ...store.photoSettings(d), ...patch }));
  const pickFiles = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  pickFiles.addEventListener('change', () => { addPhotos(pickFiles.files); pickFiles.value = ''; });
  const pickFolder = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true });
  pickFolder.addEventListener('change', () => { addPhotos(pickFolder.files); pickFolder.value = ''; });
  const canFolder = 'webkitdirectory' in pickFolder && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  const from = h('input', { type: 'time', value: ps.from });
  const to = h('input', { type: 'time', value: ps.to });
  from.addEventListener('change', () => setP({ from: from.value || '19:00' }));
  to.addEventListener('change', () => setP({ to: to.value || '20:30' }));
  const days = h('select', null, [['all', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends']].map(([v, l]) => h('option', { value: v, selected: ps.days === v }, l)));
  days.addEventListener('change', () => setP({ days: days.value }));
  const every = h('select', null, [[10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes']].map(([v, l]) => h('option', { value: String(v), selected: ps.every === v }, l)));
  every.addEventListener('change', () => setP({ every: Number(every.value) }));

  const list = photoState.list || [];
  const sel = photoState.selecting;
  const grid = h('div', { class: 'photo-grid' }, list.map((p) => {
    const t = photoState.thumbs[p.id];
    const on = photoState.picked.has(p.id);
    return h('button', { class: `ph${on ? ' on' : ''}`, 'aria-label': p.name || 'Photo', onclick: () => {
      if (!sel) { photoState.selecting = true; photoState.picked = new Set([p.id]); render(); return; }
      if (on) photoState.picked.delete(p.id); else photoState.picked.add(p.id);
      render();
    } }, t ? h('img', { src: `data:image/jpeg;base64,${t}`, alt: '', loading: 'lazy' }) : h('span', { class: 'ph-blank' }), sel ? h('span', { class: 'ph-check' }, icon('check')) : null);
  }));
  const deleteSel = () => {
    const ids = [...photoState.picked];
    confirmSheet(`Remove ${ids.length} photo${ids.length === 1 ? '' : 's'}?`, 'They come off the wall. The copies are moved to the trash in your Drive (Family Hub Photos), where they stay for 30 days.', 'Remove', async () => {
      try {
        await relay('photoDelete', { ids });
        photoState.list = list.filter((p) => !photoState.picked.has(p.id));
        photoState.selecting = false;
        photoState.picked = new Set();
        toast('Removed');
        render();
      } catch (err) { toast(err.message); }
    });
  };

  return h('div', { class: 'stack' },
    card('Add photos', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, canFolder
        ? 'Pick photos, or a whole folder. They\'re shrunk to screen size and kept privately in your Drive (Family Hub Photos).'
        : 'Pick as many as you like: tap and hold one, then tap the rest, or choose a whole album. They\'re shrunk to screen size and kept privately in your Drive.'),
      !isConnected() ? h('p', { class: 'warn-text' }, 'Connect Google to add photos.') : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', disabled: !isConnected(), onclick: () => pickFiles.click() }, icon('image'), 'Add photos'),
        canFolder ? h('button', { class: 'btn ghost', disabled: !isConnected(), onclick: () => pickFolder.click() }, icon('folder'), 'Import a folder') : null,
        pickFiles, pickFolder),
      photoState.busy ? h('div', { class: 'progress' },
        h('div', { class: 'small strong' }, `Adding photos: ${photoState.done} done, ${photoState.queue.length + 1} to go`),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.round((photoState.done / (photoState.done + photoState.queue.length + 1)) * 100)}%` } })),
        h('div', { class: 'muted small' }, 'Keep this screen open until it finishes.')) : null,
      photoState.failed.length && !photoState.busy ? h('details', { class: 'small' }, h('summary', null, `${photoState.failed.length} didn't work`), h('ul', null, photoState.failed.map((f) => h('li', null, f)))) : null)),
    card('On the wall', h('div', { class: 'list' },
      toggleRow('Photo tile', ps.tile, (on) => setP({ tile: on })),
      toggleRow('Full-screen slideshow at set times', ps.slideshow === 'schedule', (on) => setP({ slideshow: on ? 'schedule' : 'off' })),
      ps.slideshow === 'schedule' ? h('div', { class: 'btn-row pad' }, field('From', from), field('Until', to), field('Days', days)) : null,
      toggleRow('Slideshow instead of dimming at night', ps.night, (on) => setP({ night: on })),
      h('div', { class: 'pad' }, field('Change photo every', every)))),
    card(`Your photos${list.length ? ` (${list.length})` : ''}`,
      photoState.loading && !list.length ? h('p', { class: 'muted' }, 'Loading...')
        : list.length ? h('div', { class: 'stack' }, grid, h('p', { class: 'muted small' }, sel ? 'Tap photos to pick them.' : 'Tap a photo to start picking ones to remove.')) : empty(isConnected() ? 'No photos yet.' : 'Connect Google to see your photos.'),
      sel ? h('div', { class: 'btn-row' },
        h('button', { class: 'link', onclick: () => { photoState.selecting = false; photoState.picked = new Set(); render(); } }, 'Cancel'),
        h('button', { class: 'btn small danger-fill', disabled: !photoState.picked.size, onclick: deleteSel }, icon('trash'), `Remove ${photoState.picked.size || ''}`)) : null));
}

function toggleRow(label, on, onSet) {
  const btn = h('button', { class: `row toggle${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on), onclick: () => { onSet(!on); haptic(); } },
    h('div', { class: 'row-value' }, label), h('span', { class: 'switch' }, h('span', { class: 'knob' })));
  return btn;
}

function confirmSheet(title, text, yes, onYes) {
  sheet(title, h('p', null, text), { actions: [h('button', { class: 'btn ghost', onclick: () => closeSheet() }, 'Cancel'), h('button', { class: 'btn', onclick: () => { closeSheet(); onYes(); } }, yes)] });
}

function peoplePage() {
  const ppl = peopleList();
  const me = meId();
  return h('div', { class: 'stack' },
    card(null, h('div', { class: 'list' }, ppl.map((p) => row({ onclick: () => personEdit(p.id) },
      tag(p.id), h('div', { class: 'row-value' }, p.name, h('div', { class: 'muted small' }, [p.role === 'kid' ? 'Kid (school lunches)' : 'Adult', p.id === me ? 'You' : ''].filter(Boolean).join(' · '))), icon('chevron', 'tail'))),
    !ppl.length ? empty('Add everyone in the family.') : null)),
    h('button', { class: 'btn', onclick: () => personEdit() }, icon('plus'), 'Add person'));
}

function personEdit(id) {
  const p = id ? store.get(D(), 'people', id) : { name: '', role: 'kid', color: store.PERSON_COLORS[peopleList().length % store.PERSON_COLORS.length], short: '' };
  const name = h('input', { type: 'text', value: p.name, autofocus: !id, placeholder: 'Name' });
  const short = h('input', { type: 'text', value: p.short || '', maxlength: '3', placeholder: 'Auto' });
  const role = h('select', null, [['adult', 'Adult'], ['kid', 'Kid (gets school lunches)']].map(([v, l]) => h('option', { value: v, selected: p.role === v }, l)));
  let color = p.color;
  const colors = h('div', { class: 'colors' }, store.PERSON_COLORS.map((c) => {
    const b = h('button', { class: `color${c === color ? ' on' : ''}`, style: { background: c }, 'aria-label': c, onclick: () => { color = c; colors.querySelectorAll('.color').forEach((x) => x.classList.toggle('on', x === b)); } });
    return b;
  }));
  const isMe = h('input', { type: 'checkbox', checked: id && id === meId() });
  sheet(id ? p.name : 'Add person', h('div', { class: 'stack' },
    field('Name', name), field('Role', role), field('Colour', colors), field('Tag letters', short, 'Shown on events, e.g. A, B, Ca, Co. Leave blank for automatic.'),
    h('label', { class: 'checkline' }, isMe, h('span', null, 'This is me ("remind me", "task for me")'))),
  { actions: [
    id ? h('button', { class: 'btn ghost danger', onclick: () => confirmSheet(`Remove ${p.name}?`, 'Their to-dos move to Family. Calendars picked for them become Family.', 'Remove', () => {
      change((d) => {
        let x = store.remove(d, 'people', id);
        for (const t of store.live(x, 'todos')) if (t.who === id) x = store.put(x, 'todos', { id: t.id, who: 'family' });
        for (const f of store.live(x, 'feeds')) if (f.person === id) x = store.put(x, 'feeds', { id: f.id, person: '' });
        return x;
      });
    }) }, icon('trash'), 'Remove') : null,
    h('button', { class: 'btn', onclick: () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      const pid = id || store.newId();
      change((d) => {
        let x = store.put(d, 'people', { id: pid, name: n.slice(0, 30), role: role.value, color, short: short.value.trim().slice(0, 3), order: p.order ?? peopleList().length });
        if (isMe.checked) x = store.setSetting(x, 'me', pid);
        return x;
      });
      closeSheet();
    } }, 'Save'),
  ] });
}

function calendarsPage() {
  const box = h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Tick the calendars to show and pick whose each one is. Team calendars you\'ve subscribed to in Google Calendar show here too.'));
  const listEl = h('div', { class: 'list' }, h('div', { class: 'muted pad' }, isConnected() ? 'Loading your calendars...' : 'Connect Google to pick calendars.'));
  box.append(card(null, listEl));
  if (isConnected()) {
    sync.listCalendars().then((cals) => {
      const feeds = store.live(D(), 'feeds');
      const byCal = Object.fromEntries(feeds.map((f) => [f.calendarId, f]));
      const ppl = peopleList();
      cals.sort((a, b) => (byCal[b.id] ? 1 : 0) - (byCal[a.id] ? 1 : 0) || a.name.localeCompare(b.name));
      listEl.replaceChildren(...cals.map((c) => {
        const f = byCal[c.id];
        const sel = h('select', { 'aria-label': `Whose is ${c.name}`, disabled: !f }, [['', 'Family'], ...ppl.map((p) => [p.id, p.name])].map(([v, l]) => h('option', { value: v, selected: f && (f.person || '') === v }, l)));
        sel.addEventListener('change', () => { const cur = store.live(D(), 'feeds').find((x) => x.calendarId === c.id); if (cur) change((d) => store.put(d, 'feeds', { id: cur.id, person: sel.value })); });
        const chk = h('input', { type: 'checkbox', checked: Boolean(f) });
        chk.addEventListener('change', () => {
          const cur = store.live(D(), 'feeds').find((x) => x.calendarId === c.id);
          if (chk.checked && !cur) change((d) => store.put(d, 'feeds', { calendarId: c.id, name: c.name, person: sel.value }));
          if (!chk.checked && cur) change((d) => store.remove(d, 'feeds', cur.id));
          sel.disabled = !chk.checked;
        });
        return h('div', { class: 'cal-row' }, h('label', { class: 'checkline' }, chk, h('span', { class: 'dot', style: { background: c.color } }), h('span', null, c.name)), sel);
      }));
    }).catch((err) => listEl.replaceChildren(h('div', { class: 'warn-text pad' }, err.message)));
  }
  return box;
}

function rulesPage() {
  const rules = store.live(D(), 'rules').sort((a, b) => a.kw.localeCompare(b.kw));
  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'When an event\'s title has one of these words, Family Hub plans to arrive that many minutes early. Leave-by time = start - arrive early - drive time from home.'),
    card(null, h('div', { class: 'list' }, rules.map((r) => row({ onclick: () => ruleEdit(r.id) },
      h('div', { class: 'row-value' }, `"${r.kw}"`, h('div', { class: 'muted small' }, `${r.min} min early${r.person ? ` · ${whoName(r.person)} only` : ''}`)), icon('chevron', 'tail'))),
    !rules.length ? empty('No rules yet.') : null)),
    h('button', { class: 'btn', onclick: () => ruleEdit() }, icon('plus'), 'Add rule'));
}

function ruleEdit(id) {
  const r = id ? store.get(D(), 'rules', id) : { kw: '', min: 30, person: '' };
  const kw = h('input', { type: 'text', value: r.kw, placeholder: 'game', autofocus: !id });
  const min = h('input', { type: 'number', min: '0', max: '240', value: String(r.min), inputmode: 'numeric' });
  const who = h('select', null, [['', 'Anyone'], ...peopleList().map((p) => [p.id, p.name])].map(([v, l]) => h('option', { value: v, selected: (r.person || '') === v }, l)));
  sheet(id ? 'Arrival rule' : 'New arrival rule', h('div', { class: 'stack' }, field('Word in the event title', kw, 'Whole words only: "at" won\'t match "batting".'), field('Arrive this many minutes early', min), field('For', who)), { actions: [
    id ? h('button', { class: 'btn ghost danger', onclick: () => { change((d) => store.remove(d, 'rules', id)); closeSheet(); } }, icon('trash'), 'Delete') : null,
    h('button', { class: 'btn', onclick: () => {
      const k = kw.value.trim().toLowerCase();
      if (!k) { kw.focus(); return; }
      change((d) => store.put(d, 'rules', { id: id || undefined, kw: k.slice(0, 30), min: Math.max(0, Math.min(240, Number(min.value) || 0)), person: who.value }));
      closeSheet();
    } }, 'Save'),
  ] });
}

function homePage() {
  const addr = h('input', { type: 'text', value: store.setting(D(), 'homeAddress', ''), placeholder: 'Street, town', autocomplete: 'street-address' });
  addr.addEventListener('change', () => { change((d) => store.setSetting(d, 'homeAddress', addr.value.trim().slice(0, 200))); toast('Home address saved'); });
  const place = store.setting(D(), 'place', null);
  const q = h('input', { type: 'search', placeholder: 'Town for the weather', value: '' });
  const results = h('div', { class: 'list' });
  const search = async () => {
    if (!q.value.trim()) return;
    results.replaceChildren(h('div', { class: 'muted pad' }, 'Searching...'));
    try {
      const hits = await findPlace(q.value.trim());
      results.replaceChildren(...hits.map((p) => row({ onclick: () => { change((d) => store.setSetting(d, 'place', p)); ui.weather = null; loadWeather(true); toast(`Weather for ${p.name}`); render(); } }, icon('pin'), h('div', { class: 'row-value' }, p.name))));
      if (!hits.length) results.append(h('div', { class: 'muted pad' }, 'No places found.'));
    } catch (err) { results.replaceChildren(h('div', { class: 'warn-text pad' }, err.message)); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  return h('div', { class: 'stack' },
    card('Home address', h('div', { class: 'stack' }, addr, h('p', { class: 'muted small' }, 'Used for drive times to games and practices. It stays in your Drive file.'))),
    card('Weather', h('div', { class: 'stack' },
      h('div', { class: 'strong' }, place ? place.name : 'Not set'),
      h('div', { class: 'saybar' }, icon('pin', 'lead'), q, h('button', { class: 'btn small', onclick: search }, 'Find')),
      results)));
}

function accountPage() {
  const connected = isConnected();
  return h('div', { class: 'stack' },
    card(null, h('div', { class: 'stack' },
      h('div', null, h('div', { class: 'strong' }, connected ? 'Connected' : 'Not connected'), h('div', { class: 'muted small' }, accountEmail() || '')),
      h('p', { class: 'muted small' }, 'Family Hub can only see the files it made in your Drive (a "Family Hub" folder). Google sign-ins last about an hour; changes made in between wait on this phone and save when you reconnect.'),
      h('div', { class: 'btn-row' },
        connected ? h('a', { class: 'btn ghost', href: folderLink(), target: '_blank', rel: 'noopener' }, 'Open the Drive folder') : h('button', { class: 'btn', onclick: doConnect }, icon('google'), 'Connect Google'),
        connected ? h('button', { class: 'btn ghost', onclick: () => { disconnect(); toast('Disconnected'); render(); } }, 'Disconnect') : null))));
}

function aboutPage() {
  const status = h('span', { class: 'muted small' });
  return h('div', { class: 'stack' },
    card(`Version ${VERSION}`, h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: async () => {
        status.textContent = 'Checking...';
        try { const v = await latestVersion(); if (compareVersions(v, VERSION) > 0) { status.textContent = ''; showUpdate(v); } else status.textContent = 'You have the latest version.'; } catch (err) { status.textContent = err.message; }
      } }, icon('sync'), 'Check for updates'), status)),
    card('What\'s new', h('div', { class: 'releases' }, RELEASES.map((r) => h('div', { class: 'release' },
      h('div', { class: 'strong' }, `${r.version}`, h('span', { class: 'muted small' }, `  ${releaseDate(r.date)}`)),
      h('ul', null, r.notes.map((n) => h('li', null, n))))))));
}

/* ---------- updates ---------- */

function showUpdate(v) {
  if (document.getElementById('update')) return;
  document.body.append(h('div', { id: 'update', class: 'update' }, h('span', null, `Family Hub ${v} is ready.`),
    h('button', { class: 'btn small', onclick: async () => {
      try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* fine */ }
      location.reload();
    } }, 'Update')));
}
async function checkUpdate() { try { const v = await latestVersion(); if (compareVersions(v, VERSION) > 0) showUpdate(v); } catch { /* offline */ } }

/* ---------- weather ---------- */
async function loadWeather(force = false) {
  const place = store.setting(D(), 'place', null);
  if (!place) return;
  try { ui.weather = await getWeather(place, { force }); refresh(); } catch { /* keep cached */ }
}

/* ---------- start ---------- */

function startApp() {
  render();
  sync.subscribe((what) => { if (what === 'status') { const top = $('header.top'); if (top) top.replaceWith(header()); return; } refresh(); });
  onGoogle(() => refresh());
  document.addEventListener('focusout', () => setTimeout(() => { if (ui.stale && !document.querySelector('.sheet-wrap')) refresh(); }, 50));
  new MutationObserver(() => { if (ui.stale && !document.querySelector('.sheet-wrap')) refresh(); }).observe(document.body, { childList: true });
  sync.start();
  loadWeather();
  setInterval(() => loadWeather(), 30 * 60000);
  setInterval(() => { if (ui.tab === 'today') refresh(); }, 60000);
  if (isConnected()) {
    sync.load({ importOld: sync.importOldVersion }).catch(() => {});
    if (!state.feed || Date.now() - state.feed.updated > 10 * 60000) sync.refreshFeed().catch(() => {});
  }
  checkUpdate();
  setInterval(checkUpdate, 60 * 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

startApp();
