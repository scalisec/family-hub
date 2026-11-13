// The app's version and release history (newest first). Keep VERSION, package.json and
// version.json in step: the tests check they match.
export const VERSION = '3.2.3';

export const RELEASES = [
  { version: '3.2.3', date: '2026-11-13', notes: ['Events of 6 hours or more (like a tournament day) move to the top strip so they no longer squeeze the week.', 'Hour labels no longer pile up.', 'On phones the week grid keeps tiles readable and scrolls if needed, starting at the current time.'] },
  { version: '3.2.2', date: '2026-11-13', notes: ['Bigger event tiles in week view: the grid only shows the hours your week uses, and empty stretches of the day shrink so events get the room.'] },
  { version: '3.2.1', date: '2026-11-13', notes: ['Week view goes full screen: on the phone just one slim toolbar, and on the wall just a thin bar with the date, clock, next leave-by time and weather.'] },
  { version: '3.2.0', date: '2026-11-13', notes: [
    'Real calendar views: Week (time grid or 7 columns) and Month, with arrows to look ahead or back. The old list is still there.',
    'Tap an event for details and a map link, or a day for its events and dinner.',
    'The wall can show the week grid, the month, or the list (More > Calendar view). Calendars now cover about 9 weeks ahead.',
  ] },
  { version: '3.1.2', date: '2026-11-12', notes: ['The Update button now always gets the newest version.', 'Install button moved to More > About and updates.'] },
  { version: '3.1.1', date: '2026-11-12', notes: ['Install button in More: puts Family Hub on your home screen like a regular app.'] },
  { version: '3.1.0', date: '2026-11-12', notes: [
    'Seasonal theme packs: Halloween, Thanksgiving, Winter, Valentine\'s, St. Patrick\'s, Easter, Summer, Back to School and Hockey Playoffs.',
    'Seasonal (auto) changes the theme through the year by itself.',
    'Team themes: Barracudas and Bulldogs, with your team logos, and an option to wear them automatically on game days.',
    'Shop on Instacart sends the grocery list to Instacart.',
    'Photos for the wall: add many at once from your phone, or a whole folder from a PC. Photo tile and a full-screen slideshow at the times you pick (More > Photos and slideshow).',
  ] },
  { version: '3.0.1', date: '2026-11-12', notes: ['Fixed a stray "null" under the title.', 'Lunch labels use first names.', 'Leave-by times ignore a drive over 3 hours (a vague location that matched the wrong place).'] },
  { version: '3.0.0', date: '2026-11-12', notes: [
    'Rebuilt as a real app: opens instantly, every tap answers straight away, and changes save in the background.',
    'Your data lives in one file in a Family Hub folder in your Google Drive.',
    'Same look and themes, with a bottom tab bar, slide-up panels and Say or type on every screen.',
    'The wall screen has its own private link that shows everything but can\'t change anything.',
  ] },
  { version: '2.0.0', date: '2026-11-12', notes: ['Google Apps Script version with Layout, voice add, and joke and quote of the day.'] },
  { version: '1.0.0', date: '2026-11-11', notes: ['First version.'] },
];

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function latestVersion() {
  const res = await fetch(new URL(`../version.json?t=${Date.now()}`, import.meta.url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't check (${res.status}).`);
  return String((await res.json()).version || '');
}

export function releaseDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
