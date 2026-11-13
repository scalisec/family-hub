/**
 * Family Hub background helper ("relay").
 *
 * The app itself runs on GitHub Pages and keeps the family's data in a file in the owner's Google Drive.
 * This small script runs as the owner and does the three things a web page can't do alone:
 *  1. Reads the family's Google calendars every 15 minutes (kids' phones and the wall never need access).
 *  2. Works out leave-by times with Google Maps drive times.
 *  3. Serves the wall screen a read-only feed through a secret link (?key=...).
 *
 * Only the owner can change anything: every change request must carry the owner's own Google sign-in,
 * which is checked with Google before anything happens. The wall link is read-only and can be replaced
 * at any time from the app (More > Wall > New link).
 *
 * No personal details live in this code. Calendars, people, rules and the home address come from the
 * app's Drive file each time it publishes.
 */

const TZ = 'America/Toronto';
const CLIENT_ID = '1061398617166-8t015jus9o3vb95n6r46t01v46jnetkk.apps.googleusercontent.com';
const WINDOW_DAYS = 14;
const CHUNK = 45000;

// Google Calendar's event colours (the ones picked on a single event), by colour ID.
const EVENT_COLORS = {
  '1': '#7986CB', '2': '#33B679', '3': '#8E24AA', '4': '#E67C73', '5': '#F6BF26', '6': '#F4511E',
  '7': '#039BE5', '8': '#616161', '9': '#3F51B5', '10': '#0B8043', '11': '#D50000'
};

/* ---------- Entry points ---------- */

/** Wall feed: read-only, needs the secret key. */
function doGet(e) {
  const key = String((e && e.parameter && e.parameter.key) || '');
  const photo = String((e && e.parameter && e.parameter.photo) || '');
  const wallKey = props_().getProperty('WALL_KEY');
  if (!wallKey || !key || key !== wallKey) return json_({ ok: false, error: 'This wall link has been replaced. Open More > Wall in the app for the new one.' });
  try {
    if (photo) return json_({ ok: true, photo: photoData_(photo) });
    return json_({ ok: true, wall: true, snapshot: load_('snapshot') || {}, feed: feedOrSync_(), daily: daily_(), photos: photoIds_() });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/** Owner actions from the app. Body is text/plain JSON: { token, action, data }. */
function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  try {
    verify_(String(req.token || ''));
    const data = req.data || {};
    switch (String(req.action || '')) {
      case 'hello': return json_({ ok: true, hello: hello_() });
      case 'calendars': return json_({ ok: true, calendars: calendars_() });
      case 'publish': return json_({ ok: true, feed: publish_(data.snapshot || {}), daily: daily_() });
      case 'feed': return json_({ ok: true, feed: feedOrSync_(), daily: daily_() });
      case 'sync': return json_({ ok: true, feed: syncCalendars(), daily: daily_() });
      case 'rotateKey': return json_({ ok: true, wallKey: newWallKey_() });
      case 'import': return json_({ ok: true, old: importV2_() });
      case 'instacart': return json_({ ok: true, url: instacart_(data.items || [], data.title || '') });
      case 'photoAdd': return json_({ ok: true, photo: photoAdd_(data) });
      case 'photoList': return json_({ ok: true, photos: load_('photos') || [], thumbs: thumbs_() });
      case 'photoDelete': return json_({ ok: true, deleted: photoDelete_(data.ids || []) });
      default: return json_({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err), code: err.code || '' });
  }
}

/* ---------- Owner check ---------- */

function owner_() {
  const p = props_();
  let owner = p.getProperty('OWNER_EMAIL');
  if (!owner) {
    owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (owner) p.setProperty('OWNER_EMAIL', owner);
  }
  return owner;
}

/** Asks Google who the sign-in belongs to. Must be this app's sign-in and the owner's account. */
function verify_(token) {
  if (!token || token.length > 4096) throw codeErr_('Sign in with Google first.', 'signin');
  const cache = CacheService.getScriptCache();
  const ck = 'tok:' + md5_(token);
  if (cache.get(ck) === 'ok') return;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw codeErr_('Your Google sign-in has run out. Press Connect Google again.', 'signin');
  const info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID && info.azp !== CLIENT_ID) throw codeErr_('That sign-in is not from Family Hub.', 'denied');
  const email = String(info.email || '').toLowerCase();
  if (!email || email !== owner_()) throw codeErr_('Only the Family Hub owner can do this.', 'denied');
  const left = Math.max(60, Math.min(3000, Number(info.expires_in) || 0) - 60);
  cache.put(ck, 'ok', left);
}

function codeErr_(msg, code) { const e = new Error(msg); e.code = code; return e; }

/* ---------- Actions ---------- */

function hello_() {
  ensureTrigger_();
  let key = props_().getProperty('WALL_KEY');
  if (!key) key = newWallKey_();
  const feed = load_('feed');
  return { owner: owner_(), wallKey: key, updated: feed ? feed.updated : 0 };
}

function newWallKey_() {
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  props_().setProperty('WALL_KEY', key);
  return key;
}

function calendars_() {
  return CalendarApp.getAllCalendars().map(function (c) {
    return { id: c.getId(), name: c.getName(), color: String(c.getColor() || '') };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** Stores what the wall shows and what the sync needs. Re-syncs when calendars, people, rules or home change. */
function publish_(snapshot) {
  const clean = cleanSnapshot_(snapshot);
  const before = load_('snapshot') || {};
  save_('snapshot', clean);
  const feed = load_('feed');
  if (!feed || syncKey_(before) !== syncKey_(clean)) return syncCalendars();
  return feed;
}

function syncKey_(s) {
  return md5_(JSON.stringify([s.feeds || [], s.people || [], s.rules || [], s.homeAddress || '']));
}

function cleanSnapshot_(s) {
  const out = {};
  ['people', 'feeds', 'rules', 'meals', 'groceries', 'todos'].forEach(function (k) {
    out[k] = Array.isArray(s[k]) ? s[k].slice(0, 400) : [];
  });
  out.homeAddress = String(s.homeAddress || '').slice(0, 200);
  out.place = s.place && isFinite(Number(s.place.lat)) && isFinite(Number(s.place.lon))
    ? { name: String(s.place.name || '').slice(0, 80), lat: Number(s.place.lat), lon: Number(s.place.lon) } : null;
  out.theme = String(s.theme || 'Rink').slice(0, 30);
  out.themeBase = String(s.themeBase || 'Rink').slice(0, 30);
  out.teamThemes = s.teamThemes && typeof s.teamThemes === 'object' ? s.teamThemes : null;
  out.photos = s.photos && typeof s.photos === 'object' ? s.photos : {};
  out.layout = s.layout && typeof s.layout === 'object' ? s.layout : {};
  out.dim = s.dim && typeof s.dim === 'object' ? { from: String(s.dim.from || '22:00'), to: String(s.dim.to || '06:00') } : { from: '22:00', to: '06:00' };
  out.published = Date.now();
  return out;
}

function feedOrSync_() {
  const feed = load_('feed');
  if (feed && Date.now() - feed.updated < 20 * 60000) return feed;
  return syncCalendars();
}

/* ---------- Calendar sync (runs every 15 minutes as the owner) ---------- */

function syncCalendars() {
  const snap = load_('snapshot') || {};
  const people = {};
  (snap.people || []).forEach(function (p) { people[p.id] = p; });
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = from + WINDOW_DAYS * 86400000;
  const out = [];
  const errors = [];

  (snap.feeds || []).forEach(function (f) {
    const id = String(f.calendarId || '').trim();
    if (!id) return;
    try {
      const cal = CalendarApp.getCalendarById(id);
      if (!cal) throw new Error('calendar not found or not shared with you');
      const calName = cal.getName();
      const calColor = String(cal.getColor() || '');
      cal.getEvents(new Date(from), new Date(to)).forEach(function (ev) {
        out.push({
          start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime(), allDay: ev.isAllDayEvent(),
          title: tidyTitle_(ev.getTitle(), calName).slice(0, 120),
          location: String(ev.getLocation() || '').replace(/\s*\n\s*/g, ', ').slice(0, 160),
          person: String(f.person || ''), feed: String(f.name || calName).slice(0, 60), cal: id,
          color: EVENT_COLORS[String(ev.getColor() || '')] || calColor || ((people[f.person] || {}).color || '')
        });
      });
    } catch (err) {
      errors.push(String(f.name || id) + ': ' + err.message);
    }
  });

  const events = dedupe_(out);
  const feed = { events: events, nextUp: nextUp_(events, snap), updated: Date.now(), errors: errors };
  save_('feed', feed);
  return feed;
}

/** The same event can arrive through two calendars: keep one. */
function dedupe_(list) {
  const seen = {};
  return list.filter(function (e) {
    const k = e.person + '|' + e.start + '|' + String(e.title).toLowerCase();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  }).sort(function (a, b) { return a.start - b.start; });
}

/** Team apps prefix every title with the team name ("2026/27 Hawks U13B - Practice"); drop it. */
function tidyTitle_(title, calName) {
  let t = String(title || '').trim();
  const n = String(calName || '').trim();
  if (n && t.toLowerCase().indexOf(n.toLowerCase()) === 0) {
    t = t.slice(n.length).replace(/^\s*[-–:]\s*/, '').trim();
  }
  return t || String(title || 'Event');
}

/* ---------- Leave-by times ---------- */

/** First rule whose keyword is a whole word in the title (and matches the person, if the rule names one). */
function matchRule_(rules, title, person) {
  const t = String(title || '').toLowerCase();
  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i];
    const kw = String(r.kw || '').toLowerCase().trim();
    if (!kw) continue;
    if (r.person && r.person !== person) continue;
    const re = new RegExp('(^|\\W)' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\W|$)');
    if (re.test(t)) return r;
  }
  return null;
}

/** leave by = start - arrival buffer (Rules) - drive time from home. */
function nextUp_(events, snap) {
  const now = Date.now();
  const rules = (snap.rules || []).slice().sort(function (a, b) { return (b.person ? 1 : 0) - (a.person ? 1 : 0); });
  const home = String(snap.homeAddress || '');
  return events.filter(function (e) { return !e.allDay && e.start > now; }).slice(0, 6).map(function (e) {
    const rule = matchRule_(rules, e.title, e.person);
    const buffer = rule ? Math.max(0, Number(rule.min) || 0) : 0;
    const arriveBy = e.start - buffer * 60000;
    let drive = null;
    if (e.location && home) { try { drive = driveMinutes_(home, e.location); } catch (err) { drive = null; } }
    return { start: e.start, title: e.title, location: e.location, person: e.person, color: e.color,
             buffer: buffer, drive: drive, arriveBy: buffer ? arriveBy : null,
             leave: drive == null ? null : arriveBy - drive * 60000 };
  });
}

function driveMinutes_(origin, dest) {
  const cache = CacheService.getScriptCache();
  const key = 'drive2:' + md5_(origin + '|' + dest);
  const hit = cache.get(key);
  if (hit) return hit === 'x' ? null : Number(hit);
  const d = Maps.newDirectionFinder().setOrigin(origin).setDestination(dest)
    .setMode(Maps.DirectionFinder.Mode.DRIVING).setRegion('ca').getDirections();
  let minutes = d && d.routes && d.routes.length ? Math.ceil(d.routes[0].legs[0].duration.value / 60) : null;
  // A vague location ("Powerplay Hockey") can match a place hours away: treat over 3 hours as unknown.
  if (minutes != null && minutes > 180) minutes = null;
  cache.put(key, minutes == null ? 'x' : String(minutes), 21600);
  return minutes;
}

/* ---------- Joke and quote of the day ---------- */

function daily_() {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const p = props_();
  const saved = p.getProperty('DAILY');
  if (saved) { const d = JSON.parse(saved); if (d.date === today) return d; }
  const out = { date: today, joke: '', quote: '', author: '', quoteCredit: false };
  try { out.joke = fetchJoke_(); } catch (err) { out.joke = ''; }
  if (!out.joke) out.joke = 'Why did the hockey player bring string to the game? To tie the score.';
  try {
    const z = fetchQuote_();
    if (z) { out.quote = z.q; out.author = z.a; out.quoteCredit = true; }
  } catch (err) { /* fall back below */ }
  if (!out.quote) out.quote = 'Do your best today. Then do it again tomorrow.';
  p.setProperty('DAILY', JSON.stringify(out));
  return out;
}

function fetchJoke_() {
  const res = UrlFetchApp.fetch('https://icanhazdadjoke.com/', {
    muteHttpExceptions: true,
    headers: { Accept: 'application/json', 'User-Agent': 'Family Hub (personal family dashboard, Google Apps Script)' }
  });
  if (res.getResponseCode() !== 200) return '';
  return String(JSON.parse(res.getContentText()).joke || '').slice(0, 300);
}

function fetchQuote_() {
  const res = UrlFetchApp.fetch('https://zenquotes.io/api/today', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const j = JSON.parse(res.getContentText());
  if (!Array.isArray(j) || !j[0] || !j[0].q) return null;
  return { q: String(j[0].q).slice(0, 300), a: String(j[0].a || '').slice(0, 80) };
}

/* ---------- Instacart ---------- */

/**
 * Makes an Instacart shopping list page from the grocery list and returns its link.
 * Needs an Instacart Developer Platform key saved as the INSTACART_API_KEY script property
 * (Apps Script > Project Settings > Script properties). Without one, returns '' and the app
 * falls back to copying the list. INSTACART_BASE can point at the development server while testing.
 */
function instacart_(items, title) {
  const p = props_();
  const key = p.getProperty('INSTACART_API_KEY');
  if (!key) return '';
  const base = p.getProperty('INSTACART_BASE') || 'https://connect.instacart.com';
  const lines = items.map(function (t) { return String(t || '').trim().slice(0, 100); }).filter(String).slice(0, 100);
  if (!lines.length) return '';
  const res = UrlFetchApp.fetch(base + '/idp/v1/products/products_link', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    payload: JSON.stringify({
      title: String(title || 'Family Hub groceries').slice(0, 80),
      link_type: 'shopping_list',
      expires_in: 7,
      line_items: lines.map(function (t) { return { name: t, display_text: t }; }),
      landing_page_configuration: { partner_linkback_url: 'https://scalisec.github.io/family-hub/' }
    })
  });
  if (res.getResponseCode() !== 200) throw new Error('Instacart said ' + res.getResponseCode() + '. Check the Instacart key.');
  return String(JSON.parse(res.getContentText()).products_link_url || '');
}

/* ---------- Wall photos (kept in the helper's own "Family Hub Photos" folder) ---------- */

const DRIVE = 'https://www.googleapis.com/drive/v3';
const MAX_PHOTOS = 400;

function driveFetch_(url, opts) {
  const o = opts || {};
  o.muteHttpExceptions = true;
  o.headers = Object.assign({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, o.headers || {});
  const res = UrlFetchApp.fetch(url, o);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('Drive said ' + code + (code === 403 ? ': run "authorize" once in Apps Script to allow photos.' : '.'));
  return res;
}

function photoFolder_() {
  const p = props_();
  let id = p.getProperty('PHOTO_FOLDER');
  if (id) {
    try {
      const f = JSON.parse(driveFetch_(DRIVE + '/files/' + id + '?fields=id,trashed').getContentText());
      if (!f.trashed) return id;
    } catch (err) { /* make a new one */ }
  }
  const made = JSON.parse(driveFetch_(DRIVE + '/files?fields=id', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ name: 'Family Hub Photos', mimeType: 'application/vnd.google-apps.folder' })
  }).getContentText());
  p.setProperty('PHOTO_FOLDER', made.id);
  return made.id;
}

/** data: { name, key, data (base64 JPEG, about 1920 px), thumb (base64 JPEG, about 240 px), w, h } */
function photoAdd_(data) {
  const list = load_('photos') || [];
  const key = String(data.key || '').slice(0, 200);
  const dupe = key && list.find(function (x) { return x.key === key; });
  if (dupe) return dupe;
  if (list.length >= MAX_PHOTOS) throw new Error('The wall holds up to ' + MAX_PHOTOS + ' photos. Remove some first.');
  const b64 = String(data.data || '');
  if (!b64 || b64.length > 4000000) throw new Error('That photo is too big.');
  const bytes = Utilities.base64Decode(b64);
  const folder = photoFolder_();
  const up = JSON.parse(driveFetch_('https://www.googleapis.com/upload/drive/v3/files?uploadType=media&fields=id', {
    method: 'post', contentType: 'image/jpeg', payload: bytes
  }).getContentText());
  driveFetch_(DRIVE + '/files/' + up.id + '?addParents=' + folder + '&removeParents=root&fields=id', {
    method: 'patch', contentType: 'application/json',
    payload: JSON.stringify({ name: String(data.name || 'photo').slice(0, 120).replace(/\.[a-z0-9]+$/i, '') + '.jpg' })
  });
  const rec = { id: up.id, key: key, name: String(data.name || '').slice(0, 120), w: Number(data.w) || 0, h: Number(data.h) || 0, added: Date.now() };
  // The app sends photos one at a time, so a simple read-then-save is safe here.
  {
    const fresh = load_('photos') || [];
    fresh.push(rec);
    save_('photos', fresh);
    if (data.thumb && String(data.thumb).length < 45000) {
      const sh = thumbSheet_();
      sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setNumberFormat('@').setValues([[up.id, String(data.thumb)]]);
    }
  }
  return rec;
}

function photoDelete_(ids) {
  const gone = {};
  ids.slice(0, 500).forEach(function (id) {
    try { driveFetch_(DRIVE + '/files/' + encodeURIComponent(id), { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ trashed: true }) }); } catch (err) { /* already gone */ }
    gone[id] = true;
  });
  {
    save_('photos', (load_('photos') || []).filter(function (p) { return !gone[p.id]; }));
    const sh = thumbSheet_();
    const last = sh.getLastRow();
    if (last > 1) {
      const keep = sh.getRange(2, 1, last - 1, 2).getValues().filter(function (r) { return r[0] && !gone[r[0]]; });
      sh.getRange(2, 1, last - 1, 2).clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, 2).setValues(keep);
    }
  }
  return Object.keys(gone).length;
}

/** Small previews for the app's photo grid, one row each in a hidden "Thumbs" tab. */
function thumbSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Thumbs');
  if (!sh) {
    sh = ss.insertSheet('Thumbs');
    sh.getRange(1, 1, 1, 2).setValues([['photo', 'preview (written by Family Hub, do not edit)']]).setFontWeight('bold');
    sh.getRange('A:B').setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function thumbs_() {
  const sh = thumbSheet_();
  const last = sh.getLastRow();
  const out = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) { if (r[0]) out[r[0]] = r[1]; });
  return out;
}

function photoIds_() {
  return (load_('photos') || []).map(function (p) { return p.id; });
}

/** For the wall: one photo as base64, only if it's one of the wall's photos. */
function photoData_(id) {
  if (photoIds_().indexOf(id) < 0) throw new Error('No such photo.');
  const res = driveFetch_(DRIVE + '/files/' + encodeURIComponent(id) + '?alt=media');
  return Utilities.base64Encode(res.getBlob().getBytes());
}

/* ---------- Bring over the old version's setup (one time) ---------- */

/** Reads the old tabs in the Family Hub Data sheet, if they're still there. Nothing is changed. */
function importV2_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  function rows(name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    const values = sh.getDataRange().getDisplayValues();
    const head = values.shift();
    return values.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
      const o = {};
      head.forEach(function (k, i) { o[k] = r[i]; });
      return o;
    });
  }
  const settings = {};
  rows('Settings').forEach(function (r) { settings[r.key] = r.value; });
  return {
    people: rows('People'), feeds: rows('Feeds'), rules: rows('Rules'), recipes: rows('Recipes'),
    meals: rows('Meals'), groceries: rows('Groceries'), todos: rows('Todos'),
    settings: {
      theme: settings.theme || '', home_address: settings.home_address || '', location_name: settings.location_name || '',
      latitude: settings.latitude || '', longitude: settings.longitude || '', dim_from: settings.dim_from || '', dim_to: settings.dim_to || ''
    }
  };
}

/* ---------- Storage: a hidden "Store" tab in the Family Hub Data sheet ---------- */

function store_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Store');
  if (!sh) {
    sh = ss.insertSheet('Store');
    sh.getRange(1, 1, 1, 2).setValues([['key', 'json (written by Family Hub, do not edit)']]).setFontWeight('bold');
    sh.getRange('A:B').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function save_(key, value) {
  const text = JSON.stringify(value);
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push([key, text.slice(i, i + CHUNK)]);
  if (!parts.length) parts.push([key, '']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = store_();
    const last = sh.getLastRow();
    const others = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues().filter(function (r) { return r[0] && r[0] !== key; }) : [];
    const rows = others.concat(parts);
    if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
    sh.getRange(2, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
    CacheService.getScriptCache().remove('store:' + key);
  } finally {
    lock.releaseLock();
  }
}

function load_(key) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('store:' + key);
  if (hit) return JSON.parse(hit);
  const sh = store_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const text = sh.getRange(2, 1, last - 1, 2).getValues()
    .filter(function (r) { return r[0] === key; }).map(function (r) { return r[1]; }).join('');
  if (!text) return null;
  if (text.length < 90000) cache.put('store:' + key, text, 600);
  return JSON.parse(text);
}

/* ---------- Helpers ---------- */

function ensureTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) {
    if (t.getHandlerFunction() !== 'syncCalendars') return false;
    return true;
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn !== 'syncCalendars') ScriptApp.deleteTrigger(t); // old version's timers
  });
  if (!has) ScriptApp.newTrigger('syncCalendars').timeBased().everyMinutes(15).create();
}

/** Run once from the Apps Script editor after an update that asks for new permissions. */
function authorize() {
  owner_();
  ensureTrigger_();
  CalendarApp.getAllCalendars();
  UrlFetchApp.fetch('https://zenquotes.io/api/today', { muteHttpExceptions: true });
  Maps.newDirectionFinder();
  store_();
  photoFolder_();
  Logger.log('Family Hub helper is ready for ' + owner_());
}

function props_() { return PropertiesService.getScriptProperties(); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s).map(function (b) {
    return ('0' + (b & 255).toString(16)).slice(-2);
  }).join('');
}
