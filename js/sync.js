// Keeps the family's data in step: this device's copy (instant), the Drive file (shared), and the
// background helper (calendar sync and family access). Every change shows on screen straight away and
// saves to Drive a moment later; other devices' changes arrive within about 30 seconds.
//
// Family access: other family members can't see the owner's Drive file, so they keep in step through a
// shared copy held by the helper instead. The owner's app merges that copy with the Drive file whenever
// family members have been added, so both always end up the same.
import * as store from './store.js';
import { readData, writeData, dataVersion } from './drive.js';
import { isConnected, onChange as onGoogle } from './google.js';
import { relay } from './relay.js';

const LOCAL = 'fh.data';
const META = 'fh.meta';
const FEED = 'fh.feed';

function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: still works this session */ } }

const meta = { version: null, dirty: false, published: '', role: '', owner: '', family: 0, sharedVer: '', ...readJSON(META, {}) };
export const state = {
  data: store.normalize(readJSON(LOCAL, null) || store.starterData()),
  status: 'local', // local | saving | saved | offline | error
  error: '',
  feed: readJSON(FEED, null), // { events, nextUp, updated, errors, daily }
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

/* ---------- who is signed in ---------- */

// 'owner', 'member' (a family member the owner let in) or '' (not known yet).
export const role = () => meta.role;
export const isMember = () => meta.role === 'member';
export const familyCount = () => meta.family || 0;
export const ownerEmail = () => meta.owner || '';

async function whoAmI() {
  try {
    const r = await relay('hello');
    const h = r.hello;
    meta.role = h.role || 'owner';
    meta.owner = h.owner || '';
    meta.family = Number(h.family) || 0;
    saveMeta();
    return meta.role;
  } catch (err) {
    // Not allowed in: stop before anything is written to this person's own Drive.
    if (err.message && /hasn't been given access|not from Family Hub/.test(err.message)) throw err;
    state.relayError = err.message;
    notify('feed');
    return meta.role || 'owner'; // helper unreachable: carry on as before
  }
}

/* ---------- the shared copy in the helper ---------- */

// Saves to the helper's shared copy. If someone else saved first, merges their copy in and tries again.
async function sharedSave(data, base) {
  let next = data;
  let ver = base || '';
  for (let i = 0; i < 4; i += 1) {
    const r = await relay('dataPut', { data: next, base: ver });
    if (!r.conflict) return { data: next, version: r.version };
    next = store.prune(r.data ? store.merge(r.data, next) : next);
    ver = r.version;
  }
  throw new Error('Family Hub is busy saving from another phone. Try again in a moment.');
}

// Takes in a saved copy, keeping anything changed on this device since.
function adopt(saved, sent) {
  state.data = store.merge(saved, state.data);
  meta.dirty = !store.same(state.data, sent);
  saveMeta();
  saveLocal();
  notify('data');
}

async function loadMember() {
  const r = await relay('dataGet');
  if (!r.data) throw new Error(`Nothing has been shared yet. Ask ${meta.owner || 'the owner'} to open Family Hub on their phone once, then press Connect again.`);
  const merged = store.prune(state.firstRun ? store.normalize(r.data) : store.merge(r.data, state.data));
  let version = r.version;
  let final = merged;
  if (!store.same(merged, r.data)) ({ data: final, version } = await sharedSave(merged, r.version));
  state.data = final;
  meta.version = version;
}

async function pushMember() {
  const sent = store.prune(state.data);
  const r = await sharedSave(sent, meta.version);
  meta.version = r.version;
  adopt(r.data, sent);
}

// Owner only, once family members have been added: merges the shared copy and the Drive file both ways.
let lastShared = null;
async function shareSync() {
  if (meta.role !== 'owner' || !meta.family) return;
  try {
    const v = (await relay('dataVer')).version || '';
    if (v && v === meta.sharedVer && lastShared && store.same(lastShared, state.data)) return;
    const remote = v ? await relay('dataGet') : { data: null, version: '' };
    if (remote.data) {
      const merged = store.prune(store.merge(remote.data, state.data));
      if (!store.same(merged, state.data)) {
        state.data = merged;
        meta.dirty = true;
        saveLocal();
        notify('data');
        schedulePush(200);
      }
    }
    if (remote.data && store.same(remote.data, state.data)) { meta.sharedVer = remote.version; lastShared = state.data; saveMeta(); return; }
    const sent = state.data;
    const r = await sharedSave(sent, remote.version);
    meta.sharedVer = r.version;
    lastShared = r.data;
    if (!store.same(r.data, sent)) { adopt(r.data, sent); meta.dirty = true; saveMeta(); schedulePush(200); }
    saveMeta();
  } catch (err) {
    state.relayError = err.message;
    notify('feed');
  }
}

// First load after Connect Google: reads the family's data and merges it with this device's copy.
export async function load({ importOld } = {}) {
  return serial(async () => {
    setStatus('saving');
    try {
      const who = await whoAmI();
      if (who === 'member') {
        await loadMember();
        state.firstRun = false;
        state.loaded = true;
        meta.dirty = false;
        saveMeta();
        saveLocal();
        notify('data');
        setStatus('saved');
        await publish();
        return;
      }
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
      await shareSync();
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
      if (meta.role === 'member') {
        await pushMember();
        setStatus('saved');
        if (meta.dirty) schedulePush(300);
        publish().catch(() => {});
        return;
      }
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
      await shareSync();
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
    if (meta.role === 'member') {
      const v = (await relay('dataVer')).version;
      if (!v || v === meta.version) return;
      await serial(async () => {
        const r = await relay('dataGet');
        if (!r.data) return;
        state.data = store.merge(r.data, state.data);
        meta.version = r.version;
        saveMeta();
        saveLocal();
        notify('data');
        publish().catch(() => {});
      });
      return;
    }
    if (meta.role === 'owner' && meta.family) await serial(shareSync);
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

function keepFeed(r) {
  state.feed = { ...r.feed, daily: r.daily };
  state.relayError = '';
  writeJSON(FEED, state.feed);
  notify('feed');
}

// Sends the calendar setup to the helper, when they've changed.
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

// Owner only: who else can sign in (emails). With a list, replaces it.
export async function family(emails) {
  const r = await relay('family', emails ? { emails } : {});
  meta.family = r.family.length;
  saveMeta();
  if (meta.family) serial(shareSync).catch(() => {});
  return r.family;
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
