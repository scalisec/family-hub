import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/store.js';

test('merge keeps the newer change of each record and both sides\' new records', () => {
  let a = store.emptyData();
  a = store.put(a, 'groceries', { id: 'g1', text: 'Milk', done: false }, 1000);
  let b = structuredClone(a);
  a = store.put(a, 'groceries', { id: 'g1', done: true }, 2000); // phone A ticks milk
  b = store.put(b, 'groceries', { id: 'g2', text: 'Eggs' }, 1500); // phone B adds eggs
  const m = store.merge(a, b);
  assert.equal(m.groceries.g1.done, true);
  assert.equal(m.groceries.g1.text, 'Milk');
  assert.equal(m.groceries.g2.text, 'Eggs');
  assert.deepEqual(store.merge(b, a), m);
});

test('a delete is not undone by an older copy', () => {
  let a = store.put(store.emptyData(), 'todos', { id: 't1', text: 'Skates' }, 1000);
  const old = structuredClone(a);
  a = store.remove(a, 'todos', 't1', 2000);
  const m = store.merge(old, a);
  assert.equal(store.get(m, 'todos', 't1'), null);
  assert.equal(store.live(m, 'todos').length, 0);
});

test('re-adding after a delete wins, even in the same millisecond', () => {
  let a = store.put(store.emptyData(), 'groceries', { id: 'g', text: 'Milk' }, 5000);
  a = store.remove(a, 'groceries', 'g', 5000);
  a = store.put(a, 'groceries', { id: 'g', text: 'Milk', u: 1 }, 5000);
  assert.equal(store.get(a, 'groceries', 'g').text, 'Milk');
  assert.ok(a.groceries.g.u > 5000);
});

test('normalize survives junk', () => {
  const d = store.normalize({ people: 'x', todos: { a: null, b: { text: 'ok' } } });
  assert.deepEqual(Object.keys(d.todos), ['b']);
  assert.equal(d.todos.b.u, 0);
  assert.deepEqual(d.people, {});
});

test('prune drops old delete markers and old ticked groceries only', () => {
  const now = Date.UTC(2026, 10, 12);
  let d = store.emptyData();
  d = store.remove(d, 'todos', 'old', now - 40 * 86400000);
  d = store.remove(d, 'todos', 'new', now - 2 * 86400000);
  d = store.put(d, 'groceries', { id: 'a', text: 'x', done: true }, now - 9 * 86400000);
  d = store.put(d, 'groceries', { id: 'b', text: 'y', done: false }, now - 90 * 86400000);
  const p = store.prune(d, now);
  assert.ok(!p.todos.old);
  assert.ok(p.todos.new);
  assert.ok(!p.groceries.a);
  assert.ok(p.groceries.b);
});

test('snapshot carries what the wall and the calendar sync need, and no recipes', () => {
  const now = new Date(2026, 10, 12, 9).getTime();
  let d = store.starterData(now);
  d = store.put(d, 'people', { id: 'k', name: 'Kid', role: 'kid', color: '#2563EB' }, now);
  d = store.put(d, 'feeds', { calendarId: 'cal@x', name: 'Team', person: 'k' }, now);
  d = store.put(d, 'recipes', { id: 'r', name: 'Tacos', ingredients: ['shells'] }, now);
  d = store.put(d, 'meals', { id: '2026-11-12|dinner', date: '2026-11-12', slot: 'dinner', recipe: 'r' }, now);
  d = store.put(d, 'meals', { id: '2026-10-01|dinner', date: '2026-10-01', slot: 'dinner', text: 'Old' }, now);
  d = store.put(d, 'groceries', { text: 'Milk', done: false }, now);
  d = store.put(d, 'groceries', { text: 'Gone', done: true }, now);
  const s = store.snapshot(d, now);
  assert.deepEqual(s.meals, [{ date: '2026-11-12', slot: 'dinner', text: 'Tacos' }]);
  assert.deepEqual(s.groceries, [{ text: 'Milk' }]);
  assert.equal(s.feeds[0].calendarId, 'cal@x');
  assert.equal(s.people[0].short, 'K');
  assert.equal(s.rules.length, 5);
  assert.equal(s.theme, 'Rink');
  assert.equal(s.layout.week, true);
  assert.ok(!('recipes' in s));
});

test('initials: one letter unless two people share it', () => {
  const ppl = [{ id: 1, name: 'Casey' }, { id: 2, name: 'Corey' }, { id: 3, name: 'Riley' }];
  assert.equal(store.initial(ppl[0], ppl), 'Ca');
  assert.equal(store.initial(ppl[1], ppl), 'Co');
  assert.equal(store.initial(ppl[2], ppl), 'R');
  assert.equal(store.initial({ id: 4, name: 'Zed', short: 'Z!' }, ppl), 'Z!');
});

test('the old version\'s setup comes across', () => {
  const now = 1000;
  const d = store.fromV2({
    people: [{ name: 'Mom', color: '#DB2777', role: 'parent' }, { name: 'Kid', color: '#16A34A', role: 'kid' }, { name: 'Family', role: 'group' }],
    feeds: [{ name: 'Team', person: 'Kid', calendar_id: 'team@x' }, { name: 'Feed', person: 'Kid', ical_url: 'https://x' }],
    rules: [{ keyword: 'Game', person: '', arrive_early_min: '60' }],
    recipes: [{ id: 'r1', name: 'Pasta', type: 'dinner', ingredients: 'noodles\nsauce' }],
    meals: [{ date: '2026-11-13', slot: 'lunch:Kid', recipe: 'Pasta' }],
    groceries: [{ item: 'Bread', done: 'FALSE' }],
    todos: [{ text: 'Skates', person: 'Kid', due: '2026-11-14', done: 'FALSE' }],
    settings: { theme: 'Night', home_address: '1 Main St', latitude: '43.6', longitude: '-79.4', location_name: 'Town' },
  }, now);
  const kid = store.live(d, 'people').find((p) => p.name === 'Kid');
  assert.equal(store.live(d, 'people').length, 2);
  assert.equal(kid.role, 'kid');
  assert.equal(store.live(d, 'feeds').length, 1);
  assert.equal(store.live(d, 'feeds')[0].person, kid.id);
  assert.equal(store.live(d, 'rules')[0].kw, 'game');
  assert.deepEqual(store.live(d, 'recipes')[0].ingredients, ['noodles', 'sauce']);
  const meal = store.live(d, 'meals')[0];
  assert.equal(meal.slot, `lunch:${kid.id}`);
  assert.equal(meal.id, `2026-11-13|lunch:${kid.id}`);
  assert.equal(store.live(d, 'todos')[0].who, kid.id);
  assert.equal(store.setting(d, 'theme'), 'Night');
  assert.equal(store.setting(d, 'place').lat, 43.6);
  assert.equal(store.setting(d, 'me'), store.live(d, 'people').find((p) => p.name === 'Mom').id);
});
