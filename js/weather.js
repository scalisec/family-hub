// Weather from Open-Meteo (free, no key), straight from the browser. Cached for 30 minutes.
// The "what to wear" tip comes from simple rules on feels-like temperature, rain, snow and wind.
import { TIME_ZONE } from './config.js';

const CACHE_KEY = 'fh.weather';

export function wxLabel(c) {
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

export function wxIcon(c) {
  if (c === 0) return 'sun';
  if (c <= 2) return 'partly';
  if (c === 3 || c === 45 || c === 48) return 'cloud';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'rain';
}

export function wearTip(feels, rainPct, code, wind) {
  let tip;
  if (feels <= -10) tip = 'Winter coat, hat, mitts and a neck warmer';
  else if (feels <= 0) tip = 'Winter coat, hat and gloves';
  else if (feels <= 8) tip = 'Warm jacket';
  else if (feels <= 15) tip = 'Light jacket or hoodie';
  else if (feels <= 22) tip = 'Long sleeves or a light layer';
  else tip = 'T-shirt weather';
  const snow = [71, 73, 75, 77, 85, 86].includes(code);
  if (snow) tip += ' + boots';
  else if (rainPct >= 50) tip += ' + rain shell or umbrella';
  if (wind >= 30) tip += '. Windy today';
  return `${tip}.`;
}

export function shape(j) {
  const days = j.daily.time.map((d, i) => ({
    date: d, code: j.daily.weather_code[i], label: wxLabel(j.daily.weather_code[i]),
    hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]),
    rain: j.daily.precipitation_probability_max[i] ?? 0,
  }));
  const cur = j.current;
  return {
    temp: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature),
    code: cur.weather_code, label: wxLabel(cur.weather_code), wind: Math.round(cur.wind_speed_10m), days,
    wear: wearTip(Math.min(cur.apparent_temperature, j.daily.apparent_temperature_min[0] + 4), days[0].rain, days[0].code, cur.wind_speed_10m),
    at: Date.now(),
  };
}

export function cachedWeather(place) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && place && c.key === `${place.lat},${place.lon}`) return c.wx;
  } catch { /* fine */ }
  return null;
}

export async function getWeather(place, { force = false } = {}) {
  if (!place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lon))) return null;
  const cached = cachedWeather(place);
  if (!force && cached && Date.now() - cached.at < 30 * 60000) return cached;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,apparent_temperature_min'
    + `&timezone=${encodeURIComponent(TIME_ZONE)}&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather returned ${res.status}`);
  const wx = shape(await res.json());
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key: `${place.lat},${place.lon}`, wx })); } catch { /* fine */ }
  return wx;
}

// Town search for the weather location.
export async function findPlace(name) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`);
  if (!res.ok) throw new Error(`Place search returned ${res.status}`);
  const j = await res.json();
  return (j.results || []).map((r) => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '), lat: Number(r.latitude.toFixed(3)), lon: Number(r.longitude.toFixed(3)),
  }));
}
