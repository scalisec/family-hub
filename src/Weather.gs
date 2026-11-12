/**
 * Weather from Open-Meteo (free, no key). Cached 30 minutes.
 * Clothing tip comes from simple rules on "feels like" temperature, rain, snow and wind.
 */

function getWeather_(s) {
  if (!s.latitude || !s.longitude) return null;
  const lat = Number(s.latitude), lon = Number(s.longitude);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const cache = CacheService.getScriptCache();
  const key = 'wx:' + lat.toFixed(3) + ',' + lon.toFixed(3);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,apparent_temperature_min' +
    '&timezone=' + encodeURIComponent(TZ) + '&forecast_days=4';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Weather returned ' + res.getResponseCode());
  const j = JSON.parse(res.getContentText());

  const days = j.daily.time.map(function (d, i) {
    return { date: d, code: j.daily.weather_code[i], label: wxLabel_(j.daily.weather_code[i]),
             hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]),
             rain: j.daily.precipitation_probability_max[i] };
  });
  const cur = j.current;
  const out = {
    temp: Math.round(cur.temperature_2m),
    feels: Math.round(cur.apparent_temperature),
    code: cur.weather_code,
    label: wxLabel_(cur.weather_code),
    wind: Math.round(cur.wind_speed_10m),
    days: days,
    wear: wearTip_(Math.min(cur.apparent_temperature, j.daily.apparent_temperature_min[0] + 4),
                   days[0].rain, days[0].code, cur.wind_speed_10m)
  };
  cache.put(key, JSON.stringify(out), 1800);
  return out;
}

function wearTip_(feels, rainPct, code, wind) {
  let tip;
  if (feels <= -10) tip = 'Winter coat, hat, mitts and a neck warmer';
  else if (feels <= 0) tip = 'Winter coat, hat and gloves';
  else if (feels <= 8) tip = 'Warm jacket';
  else if (feels <= 15) tip = 'Light jacket or hoodie';
  else if (feels <= 22) tip = 'Long sleeves or a light layer';
  else tip = 'T-shirt weather';
  const snow = [71, 73, 75, 77, 85, 86].indexOf(code) >= 0;
  if (snow) tip += ' + boots';
  else if (rainPct >= 50) tip += ' + rain shell or umbrella';
  if (wind >= 30) tip += '. Windy today';
  return tip + '.';
}

function wxLabel_(c) {
  if (c === 0) return 'Clear';
  if (c <= 2) return 'Partly cloudy';
  if (c === 3) return 'Cloudy';
  if (c === 45 || c === 48) return 'Fog';
  if (c >= 51 && c <= 57) return 'Drizzle';
  if (c >= 61 && c <= 67) return 'Rain';
  if (c >= 71 && c <= 77) return 'Snow';
  if (c >= 80 && c <= 82) return 'Showers';
  if (c === 85 || c === 86) return 'Snow showers';
  if (c >= 95) return 'Thunderstorms';
  return 'Mixed';
}
