/**
 * Calendar feeds. Each row in the Feeds tab is either:
 * - calendar_id: a Google calendar you can see (your own, your partner's, a shared family calendar, or a team calendar
 *   you've subscribed to in Google Calendar). Easiest.
 * - ical_url: any iCal/webcal link (GameChanger, TeamLinkt, school) not already in Google Calendar.
 */

const WINDOW_DAYS = 14;

// Google Calendar's event colours (the ones you pick on a single event), by colour ID.
const EVENT_COLORS = {
  '1': '#7986CB', '2': '#33B679', '3': '#8E24AA', '4': '#E67C73', '5': '#F6BF26', '6': '#F4511E',
  '7': '#039BE5', '8': '#616161', '9': '#3F51B5', '10': '#0B8043', '11': '#D50000'
};

/**
 * The screens read events from the Events tab, which syncCalendars() refreshes every 15 minutes.
 * syncCalendars runs on a timer as the owner (you), so it can read your Google calendars and
 * subscribed team calendars. Kids' phones never need access to those calendars.
 */
function getEvents_(people) {
  const colors = {};
  people.forEach(function (p) { colors[p.name] = p.color; });
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = from + WINDOW_DAYS * 86400000;
  return rows_('Events').map(function (r) {
    const person = String(r.person || 'Family');
    const personColor = colors[person] || colors.Family || '#475569';
    const own = /^#[0-9a-f]{6}$/i.test(String(r.color)) ? String(r.color) : '';
    return { start: Number(r.start), end: Number(r.end), allDay: String(r.all_day) === 'TRUE', title: String(r.title),
             location: String(r.location), person: person, feed: String(r.feed),
             color: own || personColor, personColor: personColor };
  }).filter(function (e) { return e.end > from && e.start < to; })
    .sort(function (a, b) { return a.start - b.start; });
}

function syncCalendars() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = from + WINDOW_DAYS * 86400000;
  const out = [];
  const errors = [];
  rows_('Feeds').forEach(function (f) {
    const name = String(f.name || '');
    const person = String(f.person || 'Family');
    try {
      const id = String(f.calendar_id || '').trim();
      const url = String(f.ical_url || '').trim().replace(/^webcal:\/\//i, 'https://');
      if (id) {
        const cal = CalendarApp.getCalendarById(id);
        if (!cal) throw new Error('calendar not found or not shared with you');
        const calName = cal.getName();
        const calColor = String(cal.getColor() || '');
        cal.getEvents(new Date(from), new Date(to)).forEach(function (ev) {
          const st = ev.getStartTime();
          out.push({ start: st.getTime(), end: ev.getEndTime().getTime(), allDay: ev.isAllDayEvent(),
                     title: tidyTitle_(ev.getTitle(), calName), location: ev.getLocation() || '',
                     person: person, feed: name, color: EVENT_COLORS[String(ev.getColor() || '')] || calColor });
        });
      } else if (/^https:\/\//i.test(url)) {
        feedOccurrences_(url, from, to).forEach(function (o) {
          out.push({ start: o.start, end: o.end, allDay: o.allDay, title: tidyTitle_(o.title, name), location: o.location,
                     person: person, feed: name });
        });
      }
    } catch (e) {
      errors.push(name + ': ' + e.message);
    }
  });

  // The same event can arrive through two calendars (e.g. a team subscribed twice): keep one.
  const seen = {};
  const unique = out.filter(function (e) {
    const k = e.person + '|' + e.start + '|' + String(e.title).toLowerCase();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  }).sort(function (a, b) { return a.start - b.start; });

  withLock_(function () {
    const sh = ss_().getSheetByName('Events');
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Events.length).clearContent();
    if (unique.length) {
      sh.getRange(2, 1, unique.length, SHEETS.Events.length).setValues(unique.map(function (e) {
        return [String(e.start), String(e.end), e.allDay ? 'TRUE' : 'FALSE', String(e.title).slice(0, 120),
                String(e.location).replace(/\s*\n\s*/g, ', ').slice(0, 160), e.person, e.feed, e.color || ''];
      }));
    }
    setSetting_('last_sync', new Date().toISOString());
    setSetting_('sync_errors', errors.join(' | ').slice(0, 500));
  });
  return { events: unique.length, errors: errors };
}

/** Team apps prefix every title with the team name ("2026/27 Cudas U13B - Practice"); drop it. */
function tidyTitle_(title, calName) {
  let t = String(title || '').trim();
  const n = String(calName || '').trim();
  if (n && t.toLowerCase().indexOf(n.toLowerCase()) === 0) {
    t = t.slice(n.length).replace(/^\s*[-\u2013:]\s*/, '').trim();
  }
  return t || String(title || 'Event');
}

/** Run once (setup does this): refreshes the Events tab every 15 minutes. */
function installSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncCalendars') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncCalendars').timeBased().everyMinutes(15).create();
  return syncCalendars();
}

function feedOccurrences_(url, from, to) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('Feed returned ' + res.getResponseCode());
  const events = parseIcs_(res.getContentText());

  const overridden = {};
  events.forEach(function (e) { if (e.recurrenceId && e.uid) overridden[e.uid + '|' + e.recurrenceId] = true; });

  const out = [];
  events.forEach(function (ev) {
    if (String(ev.status || '').toUpperCase() === 'CANCELLED') return;
    const dur = (ev.end || ev.start + (ev.allDay ? 86400000 : 3600000)) - ev.start;
    expand_(ev, from, to).forEach(function (start) {
      if (!ev.recurrenceId && ev.rrule && overridden[ev.uid + '|' + start]) return;
      if (start + dur <= from || start >= to) return;
      out.push({ start: start, end: start + dur, allDay: !!ev.allDay,
                 title: (ev.title || 'Event').slice(0, 120), location: (ev.location || '').slice(0, 160)});
    });
  });
  return out;
}

function parseIcs_(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; return; }
    if (line === 'END:VEVENT') { if (cur && cur.start) out.push(cur); cur = null; return; }
    if (!cur) return;
    const idx = line.indexOf(':');
    if (idx < 0) return;
    const left = line.slice(0, idx);
    const val = line.slice(idx + 1);
    const parts = left.split(';');
    const name = parts[0].toUpperCase();
    const params = {};
    parts.slice(1).forEach(function (p) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/"/g, '');
    });
    if (name === 'SUMMARY') cur.title = unescapeIcs_(val);
    else if (name === 'LOCATION') cur.location = unescapeIcs_(val);
    else if (name === 'UID') cur.uid = val;
    else if (name === 'STATUS') cur.status = val;
    else if (name === 'RRULE') cur.rrule = val;
    else if (name === 'DTSTART') { const d = icsDate_(val, params); cur.start = d.ms; cur.allDay = d.allDay; }
    else if (name === 'DTEND') cur.end = icsDate_(val, params).ms;
    else if (name === 'EXDATE') val.split(',').forEach(function (v) { cur.exdates.push(icsDate_(v, params).ms); });
    else if (name === 'RECURRENCE-ID') cur.recurrenceId = icsDate_(val, params).ms;
  });
  return out;
}

function icsDate_(val, params) {
  const v = String(val).trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { ms: Utilities.parseDate(v.slice(0, 8), TZ, 'yyyyMMdd').getTime(), allDay: true };
  }
  if (/Z$/.test(v)) {
    return { ms: Utilities.parseDate(v.slice(0, 15), 'UTC', "yyyyMMdd'T'HHmmss").getTime(), allDay: false };
  }
  // Named zones like America/Toronto are honoured; Windows names ("Eastern Standard Time") fall back to home time.
  const tz = params.TZID && params.TZID.indexOf('/') > 0 ? params.TZID : TZ;
  return { ms: Utilities.parseDate(v.slice(0, 15), tz, "yyyyMMdd'T'HHmmss").getTime(), allDay: false };
}

function unescapeIcs_(s) {
  return String(s).replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/**
 * Expands simple repeating events (DAILY, WEEKLY with BYDAY, MONTHLY by date, YEARLY).
 * Team apps usually export each game as its own event, so this mainly covers Google calendars.
 */
function expand_(ev, from, to) {
  if (!ev.rrule) return [ev.start];
  const r = {};
  ev.rrule.split(';').forEach(function (p) { const kv = p.split('='); r[kv[0].toUpperCase()] = kv[1]; });
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL || 1));
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? icsDate_(r.UNTIL, {}).ms : Infinity;
  const ex = {};
  (ev.exdates || []).forEach(function (m) { ex[m] = true; });
  const out = [];
  const start = new Date(ev.start);
  let n = 0;

  if (freq === 'DAILY' || freq === 'WEEKLY') {
    const map = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
    const byday = r.BYDAY && freq === 'WEEKLY'
      ? r.BYDAY.split(',').map(function (d) { return map[d.slice(-2)]; })
      : [start.getDay()];
    const startMid = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const offset = (startMid.getDay() + 6) % 7;
    const cur = new Date(start);
    for (let i = 0; i < 20000; i++) {
      const ms = cur.getTime();
      if (ms > until || ms >= to || n >= count) break;
      const curMid = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
      const dayIdx = Math.round((curMid - startMid) / 86400000);
      const ok = freq === 'DAILY'
        ? dayIdx % interval === 0
        : Math.floor((dayIdx + offset) / 7) % interval === 0 && byday.indexOf(cur.getDay()) >= 0;
      if (ok) {
        n++;
        if (!ex[ms] && ms >= from - 86400000) out.push(ms);
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  if (freq === 'MONTHLY' || freq === 'YEARLY') {
    if (r.BYDAY) return ev.start >= from - 86400000 && ev.start < to ? [ev.start] : [];
    const cur = new Date(start);
    for (let i = 0; i < 2000; i++) {
      const ms = cur.getTime();
      if (ms > until || ms >= to || n >= count) break;
      n++;
      if (!ex[ms] && ms >= from - 86400000) out.push(ms);
      if (freq === 'MONTHLY') cur.setMonth(cur.getMonth() + interval);
      else cur.setFullYear(cur.getFullYear() + interval);
    }
    return out;
  }
  return [ev.start];
}

function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
