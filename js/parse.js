// "Say or type": turns a short sentence into a grocery item or a to-do.
//   "add milk and eggs"                      -> groceries: milk, eggs
//   "we need bread"                          -> groceries: bread
//   "to-do for Sam sharpen skates by Friday"   -> to-do for Sam, due Friday
//   "remind Riley to pack her bag tomorrow"  -> to-do for Riley, due tomorrow
//   "task for me book the dentist"           -> to-do for me
// Anything else comes back as { kind: 'unknown' } so the app can ask which list.
import { dateKey } from './store.js';

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tidy(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.!?;-]+$/g, '').trim();
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function splitItems(text) {
  return tidy(text)
    .split(/\s*(?:,|\band also\b|\band\b|\bplus\b|&)\s*/i)
    .map((s) => tidy(s.replace(/^(?:some|a|an|more)\s+/i, '')))
    .filter(Boolean)
    .map(cap);
}

// Finds a due date phrase at the end of the text. Returns { text, due }.
export function takeDue(text, now = new Date()) {
  const t = tidy(text);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const re = /\s*(?:\b(?:by|on|due|for|before|this|next)\s+)?\b(today|tonight|tomorrow|this weekend|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)\b\s*$/i;
  const m = re.exec(t);
  if (!m) return { text: t, due: '' };
  const word = m[1].toLowerCase();
  let d = new Date(base);
  if (word === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (word === 'today' || word === 'tonight') { /* today */ }
  else {
    const target = word.includes('weekend') ? 6 : WEEK.findIndex((w) => w.startsWith(word.slice(0, 3)));
    let diff = (target - base.getDay() + 7) % 7;
    if (diff === 0 && !word.includes('weekend')) diff = 7;
    d.setDate(d.getDate() + diff);
  }
  return { text: tidy(t.slice(0, m.index)), due: dateKey(d) };
}

// people: [{ id, name }]. meId: the person "me" means. lists: your own lists [{ id, name }].
export function parse(input, people = [], meId = '', now = new Date(), lists = []) {
  let s = tidy(input).replace(/[’]/g, "'");
  if (!s) return { kind: 'empty' };

  const names = people.filter((p) => p && p.name).map((p) => ({ id: p.id, re: new RegExp(`^${ESC(String(p.name).trim())}\\b`, 'i'), name: p.name }));
  const findPerson = (str) => {
    const x = tidy(str);
    if (/^(me|myself)\b/i.test(x)) return { id: meId || 'family', rest: tidy(x.replace(/^(me|myself)\b/i, '')) };
    if (/^(us|everyone|the family|family)\b/i.test(x)) return { id: 'family', rest: tidy(x.replace(/^(us|everyone|the family|family)\b/i, '')) };
    for (const n of names) if (n.re.test(x)) return { id: n.id, rest: tidy(x.replace(n.re, '')) };
    return null;
  };

  // remind <who> to <task> [when]
  let m = /^remind\s+(.+)$/i.exec(s);
  if (m) {
    const p = findPerson(m[1]);
    if (p) {
      const rest = p.rest.replace(/^(to|that)\s+/i, '');
      const { text, due } = takeDue(rest, now);
      if (text) return { kind: 'todo', text: cap(text), who: p.id, due };
    }
  }

  // to-do / todo / task / chore [for <who>] <task> [when]
  m = /^(?:add\s+(?:a\s+)?)?(?:to-?\s?do|task|chore|reminder)s?\s*(?:list)?\s*[:,-]?\s*(.*)$/i.exec(s);
  if (m) {
    let rest = m[1];
    let who = 'family';
    const f = /^for\s+(.+)$/i.exec(rest);
    if (f) {
      const p = findPerson(f[1]);
      if (p) { who = p.id; rest = p.rest.replace(/^(to|:|-)\s*/i, ''); }
    }
    const { text, due } = takeDue(rest, now);
    if (text) return { kind: 'todo', text: cap(text), who, due };
  }

  // <who> needs to <task> [when]
  m = /^(.+?)\s+(?:needs|has|have)\s+to\s+(.+)$/i.exec(s);
  if (m) {
    const p = findPerson(m[1]);
    if (p && !p.rest) {
      const { text, due } = takeDue(m[2], now);
      if (text) return { kind: 'todo', text: cap(text), who: p.id, due };
    }
  }

  // your own lists: "add sunscreen to the packing list", "add Lego for Sam to Christmas"
  const named = lists.filter((l) => l && l.name).sort((a, b) => b.name.length - a.name.length);
  if (named.length) {
    m = /^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+list)?$/i.exec(s)
      || /^(.+?)\s+(?:to|on)\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+list$/i.exec(s);
    if (m) {
      const want = tidy(m[2]).toLowerCase().replace(/\s+list$/, '');
      const hit = named.find((l) => l.name.toLowerCase() === want) || named.find((l) => l.name.toLowerCase().replace(/\s+list$/, '') === want)
        || named.find((l) => l.name.toLowerCase().startsWith(want) || want.startsWith(l.name.toLowerCase()));
      if (hit && !/^(grocery|groceries|shopping)$/i.test(want)) {
        const items = splitItems(m[1]);
        if (items.length) return { kind: 'list', list: hit.id, name: hit.name, items };
      }
    }
  }

  // groceries
  m = /^(?:add|buy|get|pick up|grab|we need|we're out of|we are out of|out of|need|grocer(?:y|ies)|shopping)\s*[:,-]?\s+(.+)$/i.exec(s);
  if (m) {
    const items = splitItems(m[1].replace(/\s+(?:to|on)\s+(?:the\s+)?(?:grocery|groceries|shopping)(?:\s+list)?$/i, '').replace(/\s+(?:to|on)\s+(?:the\s+)?list$/i, ''));
    if (items.length) return { kind: 'grocery', items };
  }
  m = /^(.+?)\s+(?:to|on)\s+(?:the\s+)?(?:grocery|groceries|shopping)(?:\s+list)?$/i.exec(s);
  if (m) {
    const items = splitItems(m[1]);
    if (items.length) return { kind: 'grocery', items };
  }

  return { kind: 'unknown', text: cap(s) };
}
