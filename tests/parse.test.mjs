import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, takeDue, splitItems } from '../js/parse.js';

const people = [{ id: 'g', name: 'Riley' }, { id: 'l', name: 'Sam' }, { id: 'c', name: 'Casey' }];
const thu = new Date(2026, 10, 12, 9); // Thursday Nov 12, 2026
const p = (s) => parse(s, people, 'c', thu);

test('groceries', () => {
  assert.deepEqual(p('add milk and eggs'), { kind: 'grocery', items: ['Milk', 'Eggs'] });
  assert.deepEqual(p('Add apples, yogurt and bread to the grocery list'), { kind: 'grocery', items: ['Apples', 'Yogurt', 'Bread'] });
  assert.deepEqual(p("we're out of peanut butter"), { kind: 'grocery', items: ['Peanut butter'] });
  assert.deepEqual(p('bananas to the shopping list'), { kind: 'grocery', items: ['Bananas'] });
  assert.deepEqual(p('buy some cheese'), { kind: 'grocery', items: ['Cheese'] });
});

test('to-dos with people and dates', () => {
  assert.deepEqual(p('to-do for Sam sharpen skates by Friday'), { kind: 'todo', text: 'Sharpen skates', who: 'l', due: '2026-11-13' });
  assert.deepEqual(p('remind Riley to pack her hockey bag tomorrow'), { kind: 'todo', text: 'Pack her hockey bag', who: 'g', due: '2026-11-13' });
  assert.deepEqual(p('task for me book the dentist'), { kind: 'todo', text: 'Book the dentist', who: 'c', due: '' });
  assert.deepEqual(p('remind me to call the coach'), { kind: 'todo', text: 'Call the coach', who: 'c', due: '' });
  assert.deepEqual(p('todo: clean the garage this weekend'), { kind: 'todo', text: 'Clean the garage', who: 'family', due: '2026-11-14' });
  assert.deepEqual(p('Sam needs to read for 20 minutes today'), { kind: 'todo', text: 'Read for 20 minutes', who: 'l', due: '2026-11-12' });
});

test('same weekday means next week', () => {
  assert.equal(takeDue('do it thursday', thu).due, '2026-11-19');
  assert.equal(takeDue('do it on mon', thu).due, '2026-11-16');
  assert.equal(takeDue('nothing here', thu).due, '');
});

test('unknown and empty', () => {
  assert.equal(p('').kind, 'empty');
  assert.deepEqual(p('dentist'), { kind: 'unknown', text: 'Dentist' });
});

test('splitItems', () => {
  assert.deepEqual(splitItems('a dozen eggs, milk & a loaf of bread'), ['Dozen eggs', 'Milk', 'Loaf of bread']);
});

test('your own lists', () => {
  const lists = [{ id: 'x', name: 'Christmas' }, { id: 'p', name: 'Packing for Florida' }, { id: 'b', name: 'Black Friday' }];
  const q = (s) => parse(s, people, 'c', thu, lists);
  assert.deepEqual(q('add sunscreen and hats to the packing list'), { kind: 'list', list: 'p', name: 'Packing for Florida', items: ['Sunscreen', 'Hats'] });
  assert.deepEqual(q('add Lego set to Christmas'), { kind: 'list', list: 'x', name: 'Christmas', items: ['Lego set'] });
  assert.deepEqual(q('air fryer to the black friday list'), { kind: 'list', list: 'b', name: 'Black Friday', items: ['Air fryer'] });
  assert.equal(q('add milk to the grocery list').kind, 'grocery');
  assert.equal(q('add milk').kind, 'grocery');
});
