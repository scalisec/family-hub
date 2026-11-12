/**
 * Setup screen (owner only): people, calendars and home settings.
 * Everything personal is saved in the Family Hub Data sheet, never in the code.
 */

/** First run from the web app: creates the data sheet in the visitor's Drive and makes them the owner. */
function bootstrap() {
  if (PropertiesService.getScriptProperties().getProperty('SHEET_ID')) throw new Error('Family Hub is already set up.');
  return setup();
}

function getSetup() {
  requireOwner_();
  const s = settings_();
  const feeds = {};
  rows_('Feeds').forEach(function (f) { if (f.calendar_id) feeds[String(f.calendar_id)] = String(f.person || 'Family'); });
  const calendars = CalendarApp.getAllCalendars().map(function (c) {
    return { id: c.getId(), name: c.getName(), color: String(c.getColor() || ''), person: feeds[c.getId()] || '', included: !!feeds[c.getId()] };
  }).sort(function (a, b) { return (b.included - a.included) || a.name.localeCompare(b.name); });
  return {
    people: rows_('People').map(function (p) {
      return { name: String(p.name), color: String(p.color), email: String(p.email), role: String(p.role || 'kid') };
    }),
    calendars: calendars,
    icalFeeds: rows_('Feeds').filter(function (f) { return !f.calendar_id && f.ical_url; }).length,
    settings: { home_address: s.home_address || '', location_name: s.location_name || '', dim_from: s.dim_from || '22:00', dim_to: s.dim_to || '06:00' },
    lastSync: s.last_sync || '',
    syncErrors: s.sync_errors || ''
  };
}

function savePeople(list) {
  requireOwner_();
  const clean = (Array.isArray(list) ? list : []).map(function (p) {
    return {
      name: clean_(p.name, 30),
      color: /^#[0-9a-f]{6}$/i.test(String(p.color)) ? String(p.color) : '#475569',
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email || '').trim()) ? String(p.email).trim().toLowerCase() : '',
      role: ['parent', 'kid', 'group'].indexOf(p.role) >= 0 ? p.role : 'kid'
    };
  }).filter(function (p) { return p.name && /^[^|]+$/.test(p.name); }).slice(0, 12);
  if (!clean.some(function (p) { return p.name === 'Family'; })) clean.push({ name: 'Family', color: '#475569', email: '', role: 'group' });

  const ss = ss_();
  withLock_(function () {
    const sh = ss.getSheetByName('People');
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.People.length).clearContent();
    sh.getRange(2, 1, clean.length, SHEETS.People.length).setValues(clean.map(function (p) { return [p.name, p.color, p.email, p.role]; }));
  });

  // Share the data sheet with everyone who has an email, so the app works for them.
  const owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  const editors = ss.getEditors().map(function (u) { return u.getEmail().toLowerCase(); });
  const shared = [];
  clean.forEach(function (p) {
    if (p.email && p.email !== owner && editors.indexOf(p.email) < 0) {
      safe_(function () { ss.addEditor(p.email); shared.push(p.name); }, null);
    }
  });
  return { saved: clean.length, shared: shared };
}

function saveFeeds(list) {
  requireOwner_();
  const people = rows_('People').map(function (p) { return String(p.name); });
  const own = {};
  CalendarApp.getAllCalendars().forEach(function (c) { own[c.getId()] = c.getName(); });
  const chosen = (Array.isArray(list) ? list : []).filter(function (f) { return own[f.id]; }).map(function (f) {
    return [own[f.id].slice(0, 60), people.indexOf(f.person) >= 0 ? f.person : 'Family', f.id, ''];
  });
  withLock_(function () {
    const sh = ss_().getSheetByName('Feeds');
    const keep = rows_('Feeds').filter(function (f) { return !f.calendar_id && f.ical_url; })
      .map(function (f) { return [String(f.name), String(f.person), '', String(f.ical_url)]; });
    const all = chosen.concat(keep);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Feeds.length).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, SHEETS.Feeds.length).setValues(all);
  });
  return syncCalendars();
}

function saveHome(settings) {
  requireOwner_();
  settings = settings || {};
  const address = clean_(settings.home_address, 200);
  let found = null;
  if (address) {
    const g = Maps.newGeocoder().geocode(address);
    if (!g.results || !g.results.length) throw new Error('Couldn’t find that address. Try adding the city and postal code.');
    const r = g.results[0];
    const city = (r.address_components || []).find(function (c) { return c.types.indexOf('locality') >= 0; });
    found = { lat: r.geometry.location.lat, lng: r.geometry.location.lng, city: city ? city.long_name : '' };
  }
  const time = function (t, d) { return /^\d{1,2}:\d{2}$/.test(String(t)) ? String(t) : d; };
  withLock_(function () {
    setSetting_('home_address', address);
    if (found) {
      setSetting_('latitude', String(found.lat));
      setSetting_('longitude', String(found.lng));
      setSetting_('location_name', found.city);
    }
    setSetting_('dim_from', time(settings.dim_from, '22:00'));
    setSetting_('dim_to', time(settings.dim_to, '06:00'));
  });
  return { location: found ? found.city : '' };
}
