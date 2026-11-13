import test from 'node:test';
import assert from 'node:assert/strict';
import { lanes, hourRange, hourScale, isLong, monthDays, weekStartOf, calSettings, eventsOn } from '../js/calview.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

test('weeks start on Sunday by default', () => {
  assert.equal(weekStartOf(new Date(2026, 10, 13)).getDate(), 8); // Fri Nov 13 -> Sun Nov 8
  assert.equal(weekStartOf(new Date(2026, 10, 8)).getDate(), 8);
  assert.equal(weekStartOf(new Date(2026, 10, 13), 1).getDate(), 9);
  assert.deepEqual(calSettings({}), { weekStyle: 'grid', wallView: 'week', weekStart: 0 });
});

test('month pages are whole weeks', () => {
  const nov = monthDays(2026, 10);
  assert.equal(nov.length % 7, 0);
  assert.equal(nov[0].getDay(), 0);
  assert.equal(nov[0].getDate(), 1); // Nov 1 2026 is a Sunday
  const feb = monthDays(2026, 1);
  assert.equal(feb[0].getMonth(), 1); // Feb 1 2026 is a Sunday too
  assert.equal(feb.length, 28);
});

test('overlapping events sit side by side', () => {
  const out = lanes([
    { id: 1, start: at(14, 9), end: at(14, 10) },
    { id: 2, start: at(14, 9, 30), end: at(14, 11) },
    { id: 3, start: at(14, 12), end: at(14, 13) },
  ]);
  const by = Object.fromEntries(out.map((p) => [p.e.id, p]));
  assert.equal(by[1].lanes, 2);
  assert.notEqual(by[1].lane, by[2].lane);
  assert.equal(by[3].lanes, 1);
});

test('the hour range stretches for early games', () => {
  const days = [new Date(2026, 10, 14)];
  assert.deepEqual(hourRange([{ start: at(14, 17, 30), end: at(14, 19) }, { start: at(14, 9), end: at(14, 10) }], days), [9, 19]);
  assert.deepEqual(hourRange([{ start: at(14, 18), end: at(14, 19) }], days), [13, 19]); // at least 6 hours
  assert.deepEqual(hourRange([{ start: at(14, 6), end: at(14, 7) }], days), [6, 12]);
  assert.deepEqual(hourRange([{ start: at(14, 3), end: at(14, 23, 30) }], days), [3, 24]);
  assert.deepEqual(hourRange([], days), [8, 20]);
});

test('multi-day all-day events show on each day', () => {
  const ev = [{ allDay: true, start: at(14, 0), end: at(16, 0), title: 'Tournament' }];
  assert.equal(eventsOn(ev, new Date(2026, 10, 15)).length, 1);
  assert.equal(eventsOn(ev, new Date(2026, 10, 16)).length, 0);
});

test('empty hours shrink so busy hours get the room', () => {
  const days = [new Date(2026, 10, 14)];
  const ev = [{ start: at(14, 9), end: at(14, 10) }, { start: at(14, 17), end: at(14, 19) }];
  const { at: y, weights } = hourScale(ev, days, 9, 19);
  assert.equal(weights.filter((w) => w === 1).length, 3);
  assert.equal(y(9), 0);
  assert.equal(y(19), 1);
  assert.ok(y(10) > 0.2, 'the 9 am game gets a big share');
  assert.ok(y(17) - y(10) < 0.4, 'the empty middle of the day is squeezed');
});

test('day-long events go in the all-day strip instead of stretching the hours', () => {
  assert.ok(isLong({ start: at(8, 1), end: at(8, 23) }));
  assert.ok(isLong({ start: at(8, 8), end: at(8, 14) }));
  assert.ok(!isLong({ start: at(8, 9), end: at(8, 11) }));
  assert.ok(!isLong({ allDay: true, start: at(8, 0), end: at(9, 0) }));
});
