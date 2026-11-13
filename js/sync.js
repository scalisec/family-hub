// Keeps the family's data in step: this device's copy (instant), the Drive file (shared), and the
// background helper (calendar sync and the wall). Every change shows on screen straight away and
// saves to Drive a moment later; other devices' changes arrive within about 30 seconds.
import * as store from './store.js';
import { readData, writeData, dataVersion } from './drive.js';
import { isConnected, onChange as onGoogle } from './google.js';
import { relay } from './relay.js';

const LOCAL = 'fh.data';
const META = 'fh.meta';
const FEED = 'fh.feed';

function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: still works this session */ } }

const meta = readJSON(META, { version: null, dirty: false, published: '', wallKey: '' });
export const state = {
  data: store.normalize(readJSON(LOCAL, null) || store.starterData()),
  status: 'local', // local | saving | saved | offline | error
  error: '',
  feed: readJSON(FEED, null), // { events, nextUp, updated, errors, daily }
  wallKey: meta.wallKey || '',
  firstRun: !readJSON(LOCAL, null),
  loaded: false,
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify(what = 'data') { for (const fn of listeners) fn(what); }
function setStatus(status, error = '') { state.status = status; state.error = error; notify('status'); }
function saveMeta() { writeJSON(META, meta); }
function saveLocal() { writeJSON(LOCAL, state.data); }

// Make a change: fn gets the data and returns the changed data.
export function change(fn) {
  const next = fn(state.data);
  if (!next || next === state.data) return;
  state.data = next;
  meta.dirty = true;
  saveMeta();
  saveLocal();
  notify('data');
  schedulePush();
}

let pushTimer = null;
let running = null;
function schedulePush(delay = 700) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { push().catch(() => {}); }, delay);
}

async function serial(job) {
  while (running) { try { await running; } catch { /* next */ } }
  running = job();
  try { return await running; } finally { running = null; }
}

// First load after Connect Google: reads the Drive file and merges it with this device's copy.
export async function load({ importOld } = {}) {
  return serial(async () => {
    setStatus('saving');
    try {
      const { data, version } = await readData();
      let merged;
      if (!data) {
        let start = state.data;
        if (state.firstRun && importOld) {
          const old = await importOld().catch(() => null);
          if (old && store.live(old, 'people').length) start = old;
        }
        merged = store.prune(start);
        meta.version = await writeData(merged);
      } else {
        // A brand-new device takes Drive's copy as is; a device that already had data merges both.
        merged = store.prune(state.firstRun ? store.normalize(data) : store.merge(data, state.data));
        if (!store.same(merged, data)) meta.version = await writeData(merged);
        else meta.version = version;
      }
      state.data = merged;
      state.firstRun = false;
      state.loaded = true;
      meta.dirty = false;
      saveMeta();
      saveLocal();
      notify('data');
      setStatus('saved');
      await hello();
      await publish();
    } catch (err) {
      fail(err);
      throw err;
    }
  });
}

export async function push() {
  if (!meta.dirty) return;
  if (!isConnected()) { setStatus('local'); return; }
  return serial(async () => {
    if (!meta.dirty) return;
    setStatus('saving');
    try {
      const current = await dataVersion();
      let base = state.data;
      if (current && current !== meta.version) {
        const remote = await readData();
        if (remote.data) base = store.merge(remote.data, state.data);
      }
      base = store.prune(base);
      const sent = base;
      meta.version = await writeData(sent);
      // Keep any edits made while saving.
      state.data = store.merge(sent, state.data);
      meta.dirty = !store.same(state.data, sent);
      saveMeta();
      saveLocal();
      notify('data');
      setStatus('saved');
      if (meta.dirty) schedulePush(300);
      publish().catch(() => {});
    } catch (err) {
      fail(err);
    }
  });
}

// Looks for changes from other devices.
export async function poll() {
  if (!isConnected() || running || meta.dirty) return;
  try {
    const v = await dataVersion();
    if (!v || v === meta.version) return;
    await serial(async () => {
      const { data, version } = await readData();
      if (!data) return;
      state.data = store.merge(data, state.data);
      meta.version = version;
      saveMeta();
      saveLocal();
      notify('data');
      publish().catch(() => {});
    });
  } catch (err) {
    if (err.code === 'not-connected') setStatus('local');
  }
}

function fail(err) {
  if (err && err.code === 'not-connected') setStatus('local');
  else if (!navigator.onLine) setStatus('offline');
  else setStatus('error', err && err.message ? err.message : String(err));
}

/* ---------- background helper ---------- */

async function hello() {
  try {
    const r = await relay('hello');
    state.wallKey = r.hello.wallKey;
    meta.wallKey = state.wallKey;
    saveMeta();
    notify('wall');
  } catch (err) {
    state.relayError = err.message;
    notify('feed');
  }
}

function keepFeed(r) {
  state.feed = { ...r.feed, daily: r.daily };
  state.relayError = '';
  writeJSON(FEED, state.feed);
  notify('feed');
}

// Sends the wall's copy and the calendar setup to the helper, when they've changed.
export async function publish({ force = false } = {}) {
  if (!isConnected()) return;
  const snap = store.snapshot(state.data);
  const key = JSON.stringify(snap);
  if (!force && key === meta.published) return;
  try {
    const r = await relay('publish', { snapshot: snap });
    meta.published = key;
    saveMeta();
    keepFeed(r);
  } catch (err) {
    state.relayError = err.message;
    notify('feed');
  }
}

export async function refreshFeed({ sync = false } = {}) {
  if (!isConnected()) return;
  try { keepFeed(await relay(sync ? 'sync' : 'feed')); } catch (err) { state.relayError = err.message; notify('feed'); throw err; }
}

export async function rotateWallKey() {
  const r = await relay('rotateKey');
  state.wallKey = r.wallKey;
  meta.wallKey = r.wallKey;
  saveMeta();
  notify('wall');
}

export const listCalendars = async () => (await relay('calendars')).calendars;
export const importOldVersion = async () => store.fromV2((await relay('import')).old);

export function isDirty() { return meta.dirty; }

/* ---------- timers ---------- */
let started = false;
export function start() {
  if (started) return;
  started = true;
  setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 30000);
  setInterval(() => { if (document.visibilityState === 'visible') refreshFeed().catch(() => {}); }, 5 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { poll(); if (!state.feed || Date.now() - state.feed.updated > 10 * 60000) refreshFeed().catch(() => {}); }
    else if (meta.dirty) push();
  });
  window.addEventListener('online', () => { if (meta.dirty) schedulePush(100); });
  onGoogle((on) => { if (on && meta.dirty) schedulePush(100); if (!on) setStatus(meta.dirty ? 'local' : state.status === 'saved' ? 'saved' : 'local'); });
}
