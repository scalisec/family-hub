import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, SWATCHES, easter, thanksgiving, seasonFor, resolveTheme, AUTO } from '../js/themes.js';

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

test('every theme has colours and a swatch', () => {
  for (const t of THEMES) {
    assert.match(css, new RegExp(`\\[data-theme="${t.replace(/[.']/g, (c) => `\\${c}`)}"\\]\\s*\\{ --bg:`), `${t} colours`);
    assert.equal(SWATCHES[t].length, 3, `${t} swatch`);
  }
});

test('Easter and Canadian Thanksgiving dates', () => {
  assert.deepEqual(easter(2026), [3, 5]); // April 5
  assert.deepEqual(easter(2027), [2, 28]); // March 28
  assert.deepEqual(easter(2025), [3, 20]);
  assert.deepEqual(thanksgiving(2026), [9, 12]); // Oct 12
  assert.deepEqual(thanksgiving(2025), [9, 13]);
});

test('seasons through the year', () => {
  const at = (m, d, y = 2026) => seasonFor(new Date(y, m - 1, d, 12));
  assert.equal(at(1, 5), 'Winter');
  assert.equal(at(2, 14), "Valentine's");
  assert.equal(at(3, 17), "St. Patrick's");
  assert.equal(at(4, 2), 'Easter');
  assert.equal(at(5, 1), 'Hockey Playoffs');
  assert.equal(at(7, 15), 'Summer');
  assert.equal(at(9, 3), 'Back to School');
  assert.equal(at(10, 10), 'Thanksgiving');
  assert.equal(at(10, 31), 'Halloween');
  assert.equal(at(11, 12), null);
  assert.equal(at(12, 24), 'Christmas');
});

test('auto falls back to the base theme between seasons', () => {
  assert.equal(resolveTheme(AUTO, 'Night', new Date(2026, 10, 12)), 'Night');
  assert.equal(resolveTheme(AUTO, 'Home', new Date(2026, 9, 25)), 'Halloween');
  assert.equal(resolveTheme('Easter', 'Rink', new Date(2026, 10, 12)), 'Easter');
  assert.equal(resolveTheme('Nope'), 'Rink');
});

import { gameDayTheme, isGame } from '../js/themes.js';

test('what counts as a game', () => {
  for (const t of ['Game vs Owls', 'Hawks at Bulldogs', 'Tournament: round robin', 'Playoff game 2', 'U10 Blue @ Waterloo']) assert.ok(isGame(t), t);
  for (const t of ['Practice', 'Practice at Appleby', 'Skills session', 'Team photo', 'Dryland at gym']) assert.ok(!isGame(t), t);
});

test('team theme on game day: next game wins, then stays until midnight', () => {
  const day = new Date(2026, 10, 14);
  const at = (h) => new Date(2026, 10, 14, h).getTime();
  const teams = [{ theme: 'Barracudas', calendarId: 'g' }, { theme: 'Bulldogs', calendarId: 'l' }];
  const events = [
    { cal: 'l', title: 'Game vs Hawks', start: at(9), end: at(10) },
    { cal: 'g', title: 'Cudas at Owls', start: at(15), end: at(16) },
    { cal: 'g', title: 'Practice', start: at(18), end: at(19) },
  ];
  assert.equal(gameDayTheme(events, teams, at(7)), 'Bulldogs');
  assert.equal(gameDayTheme(events, teams, at(11)), 'Barracudas');
  assert.equal(gameDayTheme(events, teams, at(22)), 'Barracudas');
  assert.equal(gameDayTheme(events, teams, new Date(2026, 10, 15, 9).getTime()), null);
  assert.equal(gameDayTheme(events, [], at(7)), null);
  assert.equal(resolveTheme('Night', 'Rink', day, 'Bulldogs'), 'Bulldogs');
});
