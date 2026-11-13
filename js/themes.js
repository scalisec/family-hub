// Themes: names, the colours shown on the picker, and Seasonal (auto), which follows the calendar.
// The full colour sets live in css/app.css ([data-theme="..."]); the tests check every theme has one.

export const BASE_THEMES = ['Rink', 'Home', 'Night', 'Christmas'];
export const SEASONAL_THEMES = ['Halloween', 'Thanksgiving', 'Winter', "Valentine's", "St. Patrick's", 'Easter', 'Summer', 'Back to School', 'Hockey Playoffs'];
export const TEAM_THEMES = ['Barracudas', 'Bulldogs'];
export const THEMES = [...BASE_THEMES, ...SEASONAL_THEMES, ...TEAM_THEMES];
export const AUTO = 'Seasonal';

// [background, card, accent] for the picker swatches.
export const SWATCHES = {
  Rink: ['#EEF3F9', '#FFFFFF', '#1D4ED8'],
  Home: ['#F6F0E8', '#FFFDFA', '#A8480F'],
  Night: ['#0B1220', '#131C2E', '#7FB4FF'],
  Christmas: ['#EFE7DA', '#166534', '#B91C1C'],
  Halloween: ['#17121F', '#221A2E', '#F97316'],
  Thanksgiving: ['#F5EBDD', '#FFFAF2', '#B45309'],
  Winter: ['#E8F1F8', '#FFFFFF', '#0E7490'],
  "Valentine's": ['#FCEFF2', '#FFFFFF', '#BE123C'],
  "St. Patrick's": ['#EAF5EC', '#FFFFFF', '#15803D'],
  Easter: ['#F7F3FB', '#FFFFFF', '#7C3AED'],
  Summer: ['#FFF8E7', '#FFFFFF', '#0284C7'],
  'Back to School': ['#F4F1E8', '#FFFFFF', '#2F5D50'],
  'Hockey Playoffs': ['#F2F5F9', '#FFFFFF', '#C8102E'],
  Barracudas: ['#111A2C', '#1A2640', '#E8553A'],
  Bulldogs: ['#E4F0FA', '#001848', '#C8102E'],
};

// Easter Sunday (Gregorian), as [month 0-11, day].
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month - 1, day];
}

// Canadian Thanksgiving: second Monday of October.
export function thanksgiving(year) {
  const first = new Date(year, 9, 1).getDay();
  return [9, 1 + ((8 - first) % 7) + 7];
}

const md = (m, d) => m * 100 + d;
function near(date, [m, d], before, after) {
  const t = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const c = new Date(date.getFullYear(), m, d).getTime();
  return t >= c - before * 86400000 && t <= c + after * 86400000;
}

// The seasonal theme for a date, or null when no season applies (then the base theme shows).
export function seasonFor(date = new Date()) {
  const y = date.getFullYear();
  const x = md(date.getMonth(), date.getDate());
  if (near(date, easter(y), 10, 1)) return 'Easter';
  if (near(date, thanksgiving(y), 6, 1)) return 'Thanksgiving';
  if (x >= md(11, 1)) return 'Christmas';
  if (x <= md(1, 6)) return 'Winter';
  if (x <= md(1, 14)) return "Valentine's";
  if (x >= md(2, 10) && x <= md(2, 17)) return "St. Patrick's";
  if (x >= md(3, 20) && x <= md(5, 15)) return 'Hockey Playoffs';
  if (x >= md(5, 21) && x <= md(7, 24)) return 'Summer';
  if (x >= md(7, 25) && x <= md(8, 12)) return 'Back to School';
  if (x >= md(9, 20) && x <= md(9, 31)) return 'Halloween';
  return null;
}

// What to show: a picked theme as is; Seasonal follows the calendar, else the chosen base.
export function resolveTheme(choice, base = 'Rink', date = new Date(), gameDay = null) {
  if (gameDay && TEAM_THEMES.includes(gameDay)) return gameDay;
  if (choice === AUTO) return seasonFor(date) || (THEMES.includes(base) ? base : 'Rink');
  return THEMES.includes(choice) ? choice : 'Rink';
}

// Game titles: "Game", "vs", "at", tournament and playoff games. Practices never count.
const GAME = /(^|\W)(game|games|vs\.?|v\.?|at|@|tournament|tourney|playoffs?|finals?|semi-?finals?|exhibition)(\W|$)/i;
export const isGame = (title) => GAME.test(String(title || '')) && !/practi[cs]e|skills|dryland|evaluation|tryout/i.test(String(title || ''));

// Team theme for today, if one of the picked team calendars has a game today.
// teams: [{ theme, calendarId }]. events: [{ start, end, title, cal }].
// Shows from the start of the day; with games for two teams, the next one to finish wins,
// and after the last game the theme stays until midnight.
export function gameDayTheme(events, teams, now = Date.now()) {
  const byCal = new Map((teams || []).filter((t) => t && t.calendarId && TEAM_THEMES.includes(t.theme)).map((t) => [t.calendarId, t.theme]));
  if (!byCal.size) return null;
  const day = new Date(now);
  const a = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const b = a + 86400000;
  const games = (events || []).filter((e) => !e.allDay && byCal.has(e.cal) && e.start >= a && e.start < b && isGame(e.title)).sort((x, y) => x.end - y.end);
  if (!games.length) return null;
  const next = games.find((g) => g.end > now) || games[games.length - 1];
  return byCal.get(next.cal);
}

// Upcoming seasons for the picker ("Halloween from Oct 20").
export function seasonCalendar(year = new Date().getFullYear()) {
  const e = easter(year);
  const t = thanksgiving(year);
  const f = (m, d) => new Date(year, m, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const shift = ([m, d], n) => { const x = new Date(year, m, d + n); return f(x.getMonth(), x.getDate()); };
  return [
    ['Winter', `${f(0, 1)} to ${f(1, 6)}`],
    ["Valentine's", `${f(1, 7)} to ${f(1, 14)}`],
    ["St. Patrick's", `${f(2, 10)} to ${f(2, 17)}`],
    ['Easter', `${shift(e, -10)} to ${shift(e, 1)}`],
    ['Hockey Playoffs', `${f(3, 20)} to ${f(5, 15)}`],
    ['Summer', `${f(5, 21)} to ${f(7, 24)}`],
    ['Back to School', `${f(7, 25)} to ${f(8, 12)}`],
    ['Thanksgiving', `${shift(t, -6)} to ${shift(t, 1)}`],
    ['Halloween', `${f(9, 20)} to ${f(9, 31)}`],
    ['Christmas', `${f(11, 1)} to ${f(11, 31)}`],
  ];
}
