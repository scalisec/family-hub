/**
 * Family Hub background helper ("relay").
 *
 * The app itself runs on GitHub Pages and keeps the family's data in a file in the owner's Google Drive.
 * This small script runs as the owner and does the three things a web page can't do alone:
 *  1. Reads the family's Google calendars when someone has the app open (no timer runs in the background).
 *  2. Works out leave-by times with Google Maps drive times.
 *  3. Fetches the joke and quote of the day.
 *
 * Only the family can change anything: every change request must carry a Google sign-in that is checked
 * with Google before anything happens. The owner can let other family members in (More > Family access);
 * they share the family's data through a copy kept here, because their own Google accounts can't see the
 * owner's Drive file. Setup jobs (calendars, family access) stay owner-only.
 * Every request needs a Google sign-in: there is no link that works without one.
 *
 * No personal details live in this code. Calendars, people, rules and the home address come from the
 * app's Drive file each time it publishes.
 */

const TZ = 'America/Toronto';
const CLIENT_ID = '1061398617166-8t015jus9o3vb95n6r46t01v46jnetkk.apps.googleusercontent.com';
const WINDOW_DAYS = 63;
const CHUNK = 45000;

// Google Calendar's event colours (the ones picked on a single event), by colour ID.
const EVENT_COLORS = {
  '1': '#7986CB', '2': '#33B679', '3': '#8E24AA', '4': '#E67C73', '5': '#F6BF26', '6': '#F4511E',
  '7': '#039BE5', '8': '#616161', '9': '#3F51B5', '10': '#0B8043', '11': '#D50000'
};

/* ---------- Entry points ---------- */

/** The wall screen's read-only link was turned off in 3.5.0. Nothing is served without a Google sign-in. */
function doGet() {
  return json_({ ok: false, error: 'The Family Hub wall screen is turned off.' });
}

// What a family member (not the owner) may do.
const MEMBER_ACTIONS = ['hello', 'publish', 'feed', 'sync', 'instacart', 'dataVer', 'dataGet', 'dataPut'];

/** Actions from the app. Body is text/plain JSON: { token, action, data }. */
function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  try {
    const who = verify_(String(req.token || ''));
    const action = String(req.action || '');
    if (who.role !== 'owner' && MEMBER_ACTIONS.indexOf(action) < 0) throw codeErr_('Only the Family Hub owner can change this.', 'denied');
    const data = req.data || {};
    switch (action) {
      case 'hello': return json_({ ok: true, hello: hello_(who) });
      case 'family': return json_({ ok: true, family: family_(data) });
      case 'dataVer': return json_({ ok: true, version: sharedVersion_() });
      case 'dataGet': return json_(Object.assign({ ok: true }, sharedGet_()));
      case 'dataPut': return json_(Object.assign({ ok: true }, sharedPut_(data)));
      case 'calendars': return json_({ ok: true, calendars: calendars_() });
      case 'publish': return json_({ ok: true, feed: publish_(data.snapshot || {}), daily: daily_() });
      case 'feed': return json_({ ok: true, feed: feedOrSync_(), daily: daily_() });
      case 'sync': return json_({ ok: true, feed: syncCalendars(), daily: daily_() });
      case 'import': return json_({ ok: true, old: importV2_() });
      case 'instacart': return json_({ ok: true, url: instacart_(data.items || [], data.title || '') });
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

/** Family members the owner has let in (emails, lower case). Kept in script properties, never in code. */
function members_() {
  try { return JSON.parse(props_().getProperty('FAMILY_EMAILS') || '[]'); } catch (err) { return []; }
}

/**
 * Asks Google who the sign-in belongs to. Must be this app's sign-in, and the owner's account or one the
 * owner has let in. Returns { email, role: 'owner' | 'member' }.
 */
function verify_(token) {
  if (!token || token.length > 4096) throw codeErr_('Sign in with Google first.', 'signin');
  const cache = CacheService.getScriptCache();
  const ck = 'tok2:' + md5_(token);
  const hit = cache.get(ck);
  if (hit) {
    const who = JSON.parse(hit);
    // Someone removed from family access loses it straight away, even with a sign-in that's still running.
    if (who.role === 'owner' || members_().indexOf(who.email) >= 0) return who;
    cache.remove(ck);
  }
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw codeErr_('Your Google sign-in has run out. Press Connect Google again.', 'signin');
  const info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID && info.azp !== CLIENT_ID) throw codeErr_('That sign-in is not from Family Hub.', 'denied');
  const email = String(info.email || '').toLowerCase();
  let role = '';
  if (email && email === owner_()) role = 'owner';
  else if (email && members_().indexOf(email) >= 0) role = 'member';
  if (!role) throw codeErr_('This Google account (' + email + ') hasn\'t been given access to Family Hub. Ask the owner to add it in More > Family access.', 'denied');
  const who = { email: email, role: role };
  const left = Math.max(60, Math.min(3000, Number(info.expires_in) || 0) - 60);
  cache.put(ck, JSON.stringify(who), left);
  return who;
}

function codeErr_(msg, code) { const e = new Error(msg); e.code = code; return e; }

/* ---------- Actions ---------- */

function hello_(who) {
  if (who.role === 'owner') { stopTimers_(); removePhotos_(); }
  if (who.role === 'owner' && props_().getProperty('WALL_KEY')) props_().deleteProperty('WALL_KEY'); // old wall link, turned off in 3.5.0
  const feed = load_('feed');
  return { owner: owner_(), role: who.role, email: who.email, family: members_().length, shared: sharedVersion_(),
           updated: feed ? feed.updated : 0 };
}

/** Owner only. data: { emails: [...] } replaces the list; with no emails, just returns it. */
function family_(data) {
  if (Array.isArray(data.emails)) {
    const clean = [];
    data.emails.slice(0, 12).forEach(function (e) {
      const v = String(e || '').trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v !== owner_() && clean.indexOf(v) < 0) clean.push(v);
    });
    props_().setProperty('FAMILY_EMAILS', JSON.stringify(clean));
  }
  return members_();
}

/* ---------- The family's shared copy (for family members, who can't see the owner's Drive file) ---------- */
// The app merges record by record (newer change wins) before saving, so the helper only has to refuse a
// save that was based on an older copy; the app then merges again and retries.

function sharedVersion_() { return props_().getProperty('SHARED_VER') || ''; }

function sharedGet_() { return { data: load_('shared'), version: sharedVersion_() }; }

/** data: { data, base }. Saves only if base is the current version; otherwise returns the current copy. */
function sharedPut_(req) {
  if (!req.data || typeof req.data !== 'object') throw new Error('Nothing to save.');
  const text = JSON.stringify(req.data);
  if (text.length > 4000000) throw new Error('The family data is too big to share.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const current = sharedVersion_();
    if (String(req.base || '') !== current) return { conflict: true, data: load_('shared'), version: current };
    saveUnlocked_('shared', req.data);
    const version = String(Date.now());
    props_().setProperty('SHARED_VER', version);
    return { conflict: false, version: version };
  } finally {
    lock.releaseLock();
  }
}

function calendars_() {
  return CalendarApp.getAllCalendars().map(function (c) {
    return { id: c.getId(), name: c.getName(), color: String(c.getColor() || '') };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** Stores what the calendar sync needs. Re-syncs when calendars, people, rules or home change. */
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
  ['people', 'feeds', 'rules', 'meals', 'groceries', 'todos', 'lists'].forEach(function (k) {
    out[k] = Array.isArray(s[k]) ? s[k].slice(0, 400) : [];
  });
  out.homeAddress = String(s.homeAddress || '').slice(0, 200);
  out.place = s.place && isFinite(Number(s.place.lat)) && isFinite(Number(s.place.lon))
    ? { name: String(s.place.name || '').slice(0, 80), lat: Number(s.place.lat), lon: Number(s.place.lon) } : null;
  out.theme = String(s.theme || 'Rink').slice(0, 30);
  out.themeBase = String(s.themeBase || 'Rink').slice(0, 30);
  out.teamThemes = s.teamThemes && typeof s.teamThemes === 'object' ? s.teamThemes : null;
  out.calendar = s.calendar && typeof s.calendar === 'object' ? s.calendar : {};
  out.teamLogos = {};
  if (s.teamLogos && typeof s.teamLogos === 'object') {
    Object.keys(s.teamLogos).slice(0, 6).forEach(function (k) {
      const v = String(s.teamLogos[k] || '');
      if (/^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length < 200000) out.teamLogos[String(k).slice(0, 30)] = v;
    });
  }
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

/* ---------- Calendar sync (runs as the owner, only when the app asks and the copy is over 20 minutes old) ---------- */

function syncCalendars() {
  const snap = load_('snapshot') || {};
  const people = {};
  (snap.people || []).forEach(function (p) { people[p.id] = p; });
  const now = new Date();
  // From the start of this month's calendar page (or last week, if earlier) to 9 weeks ahead,
  // so the month view and the next few weeks are always filled in.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = Math.min(today - 7 * 86400000, first.getTime() - first.getDay() * 86400000);
  const to = today + WINDOW_DAYS * 86400000;
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

/* ---------- Drive (only for clearing out the old wall photos) ---------- */

const DRIVE = 'https://www.googleapis.com/drive/v3';

function driveFetch_(url, opts) {
  const o = opts || {};
  o.muteHttpExceptions = true;
  o.headers = Object.assign({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, o.headers || {});
  const res = UrlFetchApp.fetch(url, o);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('Drive said ' + code + '.');
  return res;
}

/**
 * Photos were only for the wall, which was turned off in 3.5.0. Moves any stored photos and their folder to the
 * trash in the owner's Drive (kept there for 30 days) and removes the hidden previews tab. Safe to run again.
 */
function removePhotos_() {
  const p = props_();
  const trash = function (id) {
    try { driveFetch_(DRIVE + '/files/' + encodeURIComponent(id), { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ trashed: true }) }); } catch (err) { /* already gone */ }
  };
  const list = load_('photos') || [];
  list.forEach(function (ph) { trash(ph.id); });
  if (list.length) save_('photos', []);
  const folder = p.getProperty('PHOTO_FOLDER');
  if (folder) { trash(folder); p.deleteProperty('PHOTO_FOLDER'); }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const thumbs = ss.getSheetByName('Thumbs');
  if (thumbs) ss.deleteSheet(thumbs);
  return list.length;
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
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { saveUnlocked_(key, value); } finally { lock.releaseLock(); }
}

function saveUnlocked_(key, value) {
  const text = JSON.stringify(value);
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push([key, text.slice(i, i + CHUNK)]);
  if (!parts.length) parts.push([key, '']);
  {
    const sh = store_();
    const last = sh.getLastRow();
    const others = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues().filter(function (r) { return r[0] && r[0] !== key; }) : [];
    const rows = others.concat(parts);
    if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
    sh.getRange(2, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
    CacheService.getScriptCache().remove('store:' + key);
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

/** No background timer: the calendars are read only when someone has the app open. Removes any old timers. */
function stopTimers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

/** Run once from the Apps Script editor after an update that asks for new permissions. */
function authorize() {
  owner_();
  stopTimers_();
  CalendarApp.getAllCalendars();
  UrlFetchApp.fetch('https://zenquotes.io/api/today', { muteHttpExceptions: true });
  Maps.newDirectionFinder();
  store_();
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
