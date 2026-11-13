// Checks on the site as a whole: versions agree, pages are wired up, no personal details or stray
// services, and the helper's pure logic works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { VERSION, RELEASES, compareVersions } from '../js/version.js';
import { wearTip, wxLabel } from '../js/weather.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const jsFiles = readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);
const allFiles = [...jsFiles, 'index.html', 'wall.html', 'css/app.css', 'sw.js', 'apps-script/Relay.gs', 'README.md'];

test('versions agree', () => {
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.equal(JSON.parse(read('version.json')).version, VERSION);
  assert.equal(RELEASES[0].version, VERSION);
  assert.match(read('sw.js'), new RegExp(`fh-shell-${VERSION.replace(/\./g, '\\.')}`));
  for (let i = 1; i < RELEASES.length; i += 1) assert.equal(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), 1);
});

test('pages load their scripts and styles', () => {
  assert.match(read('index.html'), /src="js\/app\.js"/);
  assert.match(read('wall.html'), /src="js\/wall\.js"/);
  for (const page of ['index.html', 'wall.html']) assert.match(read(page), /href="css\/app\.css"/);
  assert.match(read('wall.html'), /name="referrer" content="no-referrer"/);
});

test('only talks to the services we expect', () => {
  const allowed = ['accounts.google.com', 'www.googleapis.com', 'oauth2.googleapis.com', 'script.google.com', 'api.open-meteo.com',
    'geocoding-api.open-meteo.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'drive.google.com', 'zenquotes.io', 'icanhazdadjoke.com',
    'connect.instacart.com', 'www.instacart.ca', 'scalisec.github.io', 'www.google.com'];
  for (const f of [...jsFiles, 'index.html', 'wall.html', 'sw.js', 'apps-script/Relay.gs']) {
    for (const m of read(f).matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.includes(m[1]), `${f} mentions ${m[1]}`);
    }
  }
});

test('no personal details or keys in the repo', () => {
  for (const f of allFiles) {
    const s = read(f);
    assert.doesNotMatch(s, /@(gmail\.com|group\.calendar\.google\.com|import\.calendar\.google\.com)/i, `${f} has an email or calendar id`);
    assert.doesNotMatch(s, /refresh_token|client_secret|AIza[0-9A-Za-z_-]{20}/, `${f} has a secret`);
  }
});

test('no emoji in the interface', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const f of allFiles) assert.doesNotMatch(read(f), emoji, f);
});

test('what-to-wear tips', () => {
  assert.equal(wearTip(-15, 0, 0, 10), 'Winter coat, hat, mitts and a neck warmer.');
  assert.equal(wearTip(-3, 0, 73, 10), 'Winter coat, hat and gloves + boots.');
  assert.equal(wearTip(12, 70, 61, 35), 'Light jacket or hoodie + rain shell or umbrella. Windy today.');
  assert.equal(wearTip(25, 0, 0, 0), 'T-shirt weather.');
  assert.equal(wxLabel(0), 'Clear');
  assert.equal(wxLabel(75), 'Snow');
});

// Load the helper (Apps Script) in a sandbox to test its pure parts.
function relay() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read('apps-script/Relay.gs'), ctx);
  return ctx;
}

test('helper: arrival rules match whole words, person rules first', () => {
  const r = relay();
  const rules = [{ kw: 'at', person: '', min: 60 }, { kw: 'practice', person: '', min: 15 }, { kw: 'game', person: '', min: 60 }];
  assert.equal(r.matchRule_(rules, 'Batting practice', 'g').min, 15);
  assert.equal(r.matchRule_(rules, 'Hawks at Owls', 'g').min, 60);
  assert.equal(r.matchRule_(rules, 'Team photo', 'g'), null);
  assert.equal(r.matchRule_([{ kw: 'game', person: 'l', min: 45 }, ...rules], 'Game vs Hawks', 'l').min, 45);
  assert.equal(r.matchRule_([{ kw: 'game', person: 'l', min: 45 }, ...rules], 'Game vs Hawks', 'g').min, 60);
});

test('helper: team name prefix is dropped from titles', () => {
  const r = relay();
  assert.equal(r.tidyTitle_('2026/27 Hawks U13B - Practice', '2026/27 Hawks U13B'), 'Practice');
  assert.equal(r.tidyTitle_('Dentist', 'Family'), 'Dentist');
  assert.equal(r.tidyTitle_('Team', 'Team'), 'Team');
});

test('helper: duplicate events from two calendars collapse to one', () => {
  const r = relay();
  const out = r.dedupe_([
    { person: 'g', start: 2, title: 'Game' }, { person: 'g', start: 2, title: 'game' }, { person: 'l', start: 1, title: 'Game' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].start, 1);
});

test('helper: snapshot is cleaned and capped', () => {
  const r = relay();
  r.Date = Date;
  const s = r.cleanSnapshot_({ people: 'nope', groceries: Array(500).fill({ text: 'x' }), place: { lat: 'abc', lon: 1 }, theme: 'Night' });
  assert.equal(s.people.length, 0);
  assert.equal(s.groceries.length, 400);
  assert.equal(s.place, null);
  assert.equal(s.theme, 'Night');
});
