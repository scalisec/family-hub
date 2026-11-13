// Date helpers. Everything works in the device's local time (the family is all in one time zone).
import { dateKey } from './store.js';

export { dateKey };
export const DAY = 86400000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function fromKey(key) { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d); }
export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

export function time(ms) {
  return new Date(ms).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, (m, p) => ` ${p.toLowerCase()}m`);
}
export function dayLabel(d, today = startOfDay()) {
  const diff = Math.round((startOfDay(d) - today) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-CA', { weekday: 'long' });
}
export const shortDate = (d) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
export const longDate = (d) => d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

export function dueLabel(key, today = startOfDay()) {
  if (!key) return '';
  const d = fromKey(key);
  const diff = Math.round((d - today) / DAY);
  if (diff < 0) return 'Overdue';
  if (diff < 7) return dayLabel(d, today);
  return shortDate(d);
}

export function minutesUntil(ms, now = Date.now()) { return Math.round((ms - now) / 60000); }
export function inLabel(ms, now = Date.now()) {
  const m = minutesUntil(ms, now);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  if (m >= 12 * 60) return '';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `in ${h} h ${r} min` : `in ${h} h`;
}
