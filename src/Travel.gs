/**
 * "Next up" with leave-by times.
 * leave by = start − arrival buffer (Rules tab) − drive time.
 * Drive time: Google Routes API with live traffic if a MAPS_API_KEY script property is set,
 * otherwise Apps Script's built-in Maps service (typical drive time, no traffic).
 */

function buildNextUp_(events, s) {
  const now = Date.now();
  const rules = rows_('Rules').map(function (r) {
    return { kw: String(r.keyword).toLowerCase(), person: String(r.person || ''), min: Number(r.arrive_early_min) || 0 };
  }).filter(function (r) { return r.kw; });
  const home = String(s.home_address || '');

  return events.filter(function (e) { return !e.allDay && e.start > now; }).slice(0, 3).map(function (e) {
    const title = String(e.title).toLowerCase();
    const rule = rules.find(function (r) {
      const kw = r.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|\\W)' + kw + '(\\W|$)').test(title) && (!r.person || r.person === e.person);
    });
    const buffer = rule ? rule.min : 0;
    const arriveBy = e.start - buffer * 60000;
    const drive = e.location && home ? safe_(function () { return driveMinutes_(home, e.location, arriveBy); }, null) : null;
    const leave = drive == null ? null : arriveBy - drive * 60000;
    const why = [];
    if (buffer) why.push('Arrive ' + buffer + ' min early');
    if (drive != null) why.push(drive + ' min drive' + (PropertiesService.getScriptProperties().getProperty('MAPS_API_KEY') ? ' in traffic' : ''));
    return { start: e.start, title: e.title, location: e.location, person: e.person, color: e.color, personColor: e.personColor, feed: e.feed,
             leave: leave, arriveBy: buffer ? arriveBy : null, why: why.join(' · ') };
  });
}

function driveMinutes_(origin, dest, arriveBy) {
  const cache = CacheService.getScriptCache();
  const slot = Math.floor(arriveBy / 1800000); // re-check every 30 min of event time
  const key = 'drive:' + md5_(origin + '|' + dest) + ':' + slot;
  const hit = cache.get(key);
  if (hit) return Number(hit);

  const apiKey = PropertiesService.getScriptProperties().getProperty('MAPS_API_KEY');
  let minutes;
  if (apiKey) {
    // Estimate departure ~45 min before arrival; Routes API needs a time in the future.
    const depart = Math.max(Date.now() + 60000, arriveBy - 45 * 60000);
    const res = UrlFetchApp.fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'routes.duration' },
      payload: JSON.stringify({
        origin: { address: origin },
        destination: { address: dest },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        departureTime: new Date(depart).toISOString()
      })
    });
    if (res.getResponseCode() !== 200) throw new Error('Routes API ' + res.getResponseCode());
    const j = JSON.parse(res.getContentText());
    minutes = Math.ceil(parseInt(j.routes[0].duration, 10) / 60);
  } else {
    const d = Maps.newDirectionFinder().setOrigin(origin).setDestination(dest)
      .setMode(Maps.DirectionFinder.Mode.DRIVING).getDirections();
    if (!d.routes || !d.routes.length) return null;
    minutes = Math.ceil(d.routes[0].legs[0].duration.value / 60);
  }
  cache.put(key, String(minutes), 1800);
  return minutes;
}
