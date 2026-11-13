// The app's version and release history (newest first). Keep VERSION, package.json and
// version.json in step: the tests check they match.
export const VERSION = '3.0.0';

export const RELEASES = [
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
