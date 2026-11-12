/**
 * Family Hub — server side (Google Apps Script).
 * The script is bound to the "Family Hub Data" sheet and can only open that one sheet
 * (spreadsheets.currentonly), plus read calendars for the sync.
 * The web app runs as the person who opens it, so only people the Sheet
 * is shared with can read or change anything.
 */

const TZ = 'America/Toronto';

const SHEETS = {
  Settings:  ['key', 'value'],
  People:    ['name', 'color', 'email', 'role'],
  Feeds:     ['name', 'person', 'calendar_id', 'ical_url'],
  Events:    ['start', 'end', 'all_day', 'title', 'location', 'person', 'feed', 'color'],
  Rules:     ['keyword', 'person', 'arrive_early_min'],
  Recipes:   ['id', 'name', 'url', 'type', 'ingredients', 'notes'],
  Meals:     ['date', 'slot', 'recipe', 'cook'],
  Groceries: ['id', 'item', 'done', 'added_by', 'added_at'],
  Todos:     ['id', 'text', 'person', 'due', 'done', 'added_by'],
  Layout:    ['tile', 'column', 'order', 'show'],
  Jokes:     ['text'],
  Quotes:    ['text', 'author']
};

const TILES = ['next_up', 'week', 'meals', 'todos', 'groceries', 'joke', 'quote'];

const THEMES = ['Rink', 'Home', 'Night', 'Christmas'];

/* ---------- Web app entry ---------- */

function doGet(e) {
  const raw = (e && e.parameter && e.parameter.view) || '';
  const t = HtmlService.createTemplateFromFile('Index');
  t.view = raw === 'wall' ? 'wall' : 'remote';
  return t.evaluate()
    .setTitle('Family Hub')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ---------- One-time setup (run from the editor as the owner) ---------- */

function setup() {
  const props = PropertiesService.getScriptProperties();
  const owner = props.getProperty('OWNER_EMAIL');
  if (owner && owner !== me_().toLowerCase()) throw new Error('Family Hub is already set up by its owner.');
  if (!owner) props.setProperty('OWNER_EMAIL', me_().toLowerCase());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Keep every cell as plain text so dates like 2026-11-12 are not converted.
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
  });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  seedIfEmpty_(ss, 'Settings', [
    ['theme', 'Rink'],
    ['location_name', ''],
    ['latitude', ''],
    ['longitude', ''],
    ['home_address', ''],
    ['dim_from', '22:00'],
    ['dim_to', '06:00']
  ]);
  // People and calendars are added from the Setup screen, so no personal details live in the code.
  seedIfEmpty_(ss, 'People', [['Family', '#475569', '', 'group']]);
  seedIfEmpty_(ss, 'Rules', [
    ['game', '', '60'],
    ['vs', '', '60'],
    ['at', '', '60'],
    ['tournament', '', '60'],
    ['practice', '', '15']
  ]);
  seedIfEmpty_(ss, 'Layout', [
    ['next_up', '1', '1', 'TRUE'],
    ['joke', '1', '2', 'TRUE'],
    ['week', '2', '1', 'TRUE'],
    ['quote', '2', '2', 'TRUE'],
    ['meals', '3', '1', 'TRUE'],
    ['todos', '3', '2', 'TRUE'],
    ['groceries', '3', '3', 'TRUE']
  ]);
  const sync = installSync();
  Logger.log('Calendar sync: ' + sync.events + ' events' + (sync.errors.length ? '; problems: ' + sync.errors.join(' | ') : ''));
  Logger.log('Family Hub data sheet: ' + ss.getUrl());
  return ss.getUrl();
}

function seedIfEmpty_(ss, name, rows) {
  const sh = ss.getSheetByName(name);
  if (sh.getLastRow() > 1) return;
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/* ---------- Sheet helpers ---------- */

function ss_() {
  if (!PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL')) throw new Error('NOT_SET_UP');
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) throw new Error('NO_ACCESS');
  return ss;
}

function isOwner_() {
  const owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  return !!owner && owner === me_().toLowerCase();
}

function requireOwner_() {
  if (!isOwner_()) throw new Error('Only the Family Hub owner can change setup.');
}

function rows_(name) {
  const sh = ss_().getSheetByName(name);
  const values = sh.getDataRange().getValues();
  const head = values.shift() || [];
  const out = [];
  values.forEach(function (r, i) {
    if (r.join('') === '') return;
    const o = { _row: i + 2 };
    head.forEach(function (k, j) {
      let v = r[j];
      if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      o[k] = v;
    });
    out.push(o);
  });
  return out;
}

function append_(name, obj) {
  const head = SHEETS[name];
  ss_().getSheetByName(name).appendRow(head.map(function (k) {
    return obj[k] === undefined || obj[k] === null ? '' : String(obj[k]);
  }));
}

function setCell_(name, row, key, value) {
  ss_().getSheetByName(name).getRange(row, SHEETS[name].indexOf(key) + 1).setValue(String(value));
}

function deleteRows_(name, rowNumbers) {
  const sh = ss_().getSheetByName(name);
  rowNumbers.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function setSetting_(key, value) {
  const r = rows_('Settings').find(function (x) { return x.key === key; });
  if (r) setCell_('Settings', r._row, 'value', value);
  else append_('Settings', { key: key, value: value });
}

function settings_() {
  const o = {};
  rows_('Settings').forEach(function (r) { o[String(r.key)] = String(r.value); });
  return o;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function clean_(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200);
}

function newId_() {
  return Utilities.getUuid().slice(0, 8);
}

function me_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function safe_(fn, fallback) {
  try { return fn(); } catch (e) { console.warn(e); return fallback; }
}

function dateKey_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/* ---------- Read: everything the screens need, in one call ---------- */

function getDashboard(weekOffset) {
  const s = settings_();
  const people = rows_('People').map(function (p) {
    return { name: String(p.name), color: String(p.color), role: String(p.role) };
  });
  const events = safe_(function () { return getEvents_(people); }, []);
  const weather = safe_(function () { return getWeather_(s); }, null);
  const nextUp = safe_(function () { return buildNextUp_(events, s); }, []);

  // Week for the meal planner: Monday to Sunday, shifted by weekOffset.
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + 7 * (Number(weekOffset) || 0));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push(dateKey_(d));
  }

  const meals = {};
  rows_('Meals').forEach(function (m) {
    meals[m.date + '|' + m.slot] = { recipe: String(m.recipe), cook: String(m.cook) };
  });

  const email = me_().toLowerCase();
  const meRow = email ? rows_('People').find(function (p) { return String(p.email).toLowerCase() === email; }) : null;

  return {
    tz: TZ,
    now: Date.now(),
    layout: layout_(),
    daily: safe_(getDaily_, null),
    me: meRow ? String(meRow.name) : '',
    today: dateKey_(today),
    theme: THEMES.indexOf(s.theme) >= 0 ? s.theme : 'Rink',
    themes: THEMES,
    dim: { from: s.dim_from || '22:00', to: s.dim_to || '06:00' },
    locationName: s.location_name || '',
    hasHome: !!s.home_address,
    lastSync: s.last_sync || '',
    syncErrors: s.sync_errors || '',
    people: people,
    events: events,
    nextUp: nextUp,
    weather: weather,
    week: week,
    weekOffset: Number(weekOffset) || 0,
    meals: meals,
    recipes: rows_('Recipes').map(function (r) {
      return { id: String(r.id), name: String(r.name), url: String(r.url), type: String(r.type || 'dinner'),
               ingredients: String(r.ingredients), notes: String(r.notes) };
    }),
    groceries: rows_('Groceries').map(function (g) {
      return { id: String(g.id), item: String(g.item), done: String(g.done) === 'TRUE' };
    }),
    todos: rows_('Todos').map(function (t) {
      return { id: String(t.id), text: String(t.text), person: String(t.person), due: String(t.due),
               done: String(t.done) === 'TRUE' };
    }),
    sheetUrl: ss_().getUrl(),
    isOwner: isOwner_(),
    appUrl: safe_(function () { return ScriptApp.getService().getUrl(); }, ''),
    user: me_()
  };
}

/* ---------- Write: small, validated changes ---------- */

function addTodo(text, person, due) {
  text = clean_(text, 160);
  if (!text) throw new Error('Type a to-do first.');
  due = /^\d{4}-\d{2}-\d{2}$/.test(String(due)) ? String(due) : '';
  return withLock_(function () {
    append_('Todos', { id: newId_(), text: text, person: clean_(person, 40) || 'Family', due: due, done: 'FALSE', added_by: me_() });
    return true;
  });
}

function toggleTodo(id) {
  return withLock_(function () {
    const r = rows_('Todos').find(function (x) { return String(x.id) === String(id); });
    if (r) setCell_('Todos', r._row, 'done', String(r.done) === 'TRUE' ? 'FALSE' : 'TRUE');
    return true;
  });
}

function clearDoneTodos() {
  return withLock_(function () {
    deleteRows_('Todos', rows_('Todos').filter(function (x) { return String(x.done) === 'TRUE'; }).map(function (x) { return x._row; }));
    return true;
  });
}

function addGrocery(item) {
  item = clean_(item, 80);
  if (!item) throw new Error('Type an item first.');
  return withLock_(function () {
    addGroceryUnlocked_(item);
    return true;
  });
}

function addGroceries(items) {
  const list = (Array.isArray(items) ? items : []).map(function (i) { return clean_(i, 80); }).filter(String).slice(0, 30);
  if (!list.length) throw new Error('No items to add.');
  return withLock_(function () {
    let added = 0;
    list.forEach(function (i) { if (addGroceryUnlocked_(i)) added++; });
    return added;
  });
}

function addGroceryUnlocked_(item) {
  const exists = rows_('Groceries').some(function (g) {
    return String(g.done) !== 'TRUE' && String(g.item).toLowerCase() === item.toLowerCase();
  });
  if (exists) return false;
  append_('Groceries', { id: newId_(), item: item, done: 'FALSE', added_by: me_(), added_at: new Date().toISOString() });
  return true;
}

function toggleGrocery(id) {
  return withLock_(function () {
    const r = rows_('Groceries').find(function (x) { return String(x.id) === String(id); });
    if (r) setCell_('Groceries', r._row, 'done', String(r.done) === 'TRUE' ? 'FALSE' : 'TRUE');
    return true;
  });
}

function clearDoneGroceries() {
  return withLock_(function () {
    deleteRows_('Groceries', rows_('Groceries').filter(function (x) { return String(x.done) === 'TRUE'; }).map(function (x) { return x._row; }));
    return true;
  });
}

function setMeal(date, slot, recipe, cook) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Bad date.');
  slot = clean_(slot, 40);
  if (!/^(dinner|lunch:[^|]{1,30})$/.test(slot)) throw new Error('Bad meal slot.');
  recipe = clean_(recipe, 120);
  return withLock_(function () {
    const found = rows_('Meals').filter(function (m) { return m.date === date && String(m.slot) === slot; });
    deleteRows_('Meals', found.map(function (m) { return m._row; }));
    if (recipe) append_('Meals', { date: date, slot: slot, recipe: recipe, cook: clean_(cook, 40) });
    return true;
  });
}

function addRecipe(r) {
  r = r || {};
  const name = clean_(r.name, 120);
  if (!name) throw new Error('Give the recipe a name.');
  let url = clean_(r.url, 500);
  if (url && !/^https?:\/\//i.test(url)) url = '';
  const type = ['dinner', 'lunch', 'both'].indexOf(r.type) >= 0 ? r.type : 'dinner';
  const ingredients = String(r.ingredients || '').split(/\r?\n/).map(function (l) { return clean_(l, 80); })
    .filter(String).slice(0, 60).join('\n');
  return withLock_(function () {
    append_('Recipes', { id: newId_(), name: name, url: url, type: type, ingredients: ingredients, notes: clean_(r.notes, 500) });
    return true;
  });
}

function addWeekIngredients(weekStart) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart))) throw new Error('Bad week.');
  const start = Utilities.parseDate(weekStart, TZ, 'yyyy-MM-dd');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(dateKey_(d));
  }
  return withLock_(function () {
    const byName = {};
    rows_('Recipes').forEach(function (r) { byName[String(r.name).toLowerCase()] = r; });
    let added = 0;
    rows_('Meals').filter(function (m) { return days.indexOf(m.date) >= 0; }).forEach(function (m) {
      const r = byName[String(m.recipe).toLowerCase()];
      if (!r) return;
      String(r.ingredients).split('\n').map(function (l) { return clean_(l, 80); }).filter(String)
        .forEach(function (item) { if (addGroceryUnlocked_(item)) added++; });
    });
    return added;
  });
}

function setTheme(name) {
  if (THEMES.indexOf(name) < 0) throw new Error('Unknown theme.');
  return withLock_(function () {
    const r = rows_('Settings').find(function (x) { return x.key === 'theme'; });
    if (r) setCell_('Settings', r._row, 'value', name);
    else append_('Settings', { key: 'theme', value: name });
    return true;
  });
}

/* ---------- Layout: which tiles show on the wall, in which column and order ---------- */

function layout_() {
  const rows = safe_(function () { return rows_('Layout'); }, []);
  const out = rows.map(function (r) {
    return { tile: String(r.tile).trim().toLowerCase(), column: Math.min(4, Math.max(1, Number(r.column) || 1)),
             order: Number(r.order) || 99, show: String(r.show).toUpperCase() !== 'FALSE' };
  }).filter(function (r) { return r.show && TILES.indexOf(r.tile) >= 0; });
  if (out.length) return out.sort(function (a, b) { return a.column - b.column || a.order - b.order; });
  return [
    { tile: 'next_up', column: 1, order: 1 }, { tile: 'joke', column: 1, order: 2 },
    { tile: 'week', column: 2, order: 1 }, { tile: 'quote', column: 2, order: 2 },
    { tile: 'meals', column: 3, order: 1 }, { tile: 'todos', column: 3, order: 2 }, { tile: 'groceries', column: 3, order: 3 }
  ];
}
