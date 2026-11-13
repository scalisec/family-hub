// Google Drive: the "Family Hub" folder and the one data file in it.
// With the drive.file permission the app only ever sees files and folders it created.
import { gfetch, gjson } from './google.js';
import { ROOT_FOLDER, DATA_FILE } from './config.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const IDS_KEY = 'fh.driveIds';

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function loadIds() { try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{}'); } catch { return {}; } }
function saveIds(ids) { try { localStorage.setItem(IDS_KEY, JSON.stringify(ids)); } catch { /* fine */ } }
let ids = loadIds();

export function forgetDriveIds() { ids = {}; saveIds(ids); }

async function findChild(parentId, name, mimeType) {
  const q = [`name = ${quote(name)}`, `${quote(parentId)} in parents`, 'trashed = false'];
  if (mimeType) q.push(`mimeType = ${quote(mimeType)}`);
  const res = await gjson(`${API}/files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name,modifiedTime)&spaces=drive&pageSize=10&orderBy=modifiedTime desc`);
  return res.files && res.files[0] ? res.files[0] : null;
}

async function folderId() {
  if (ids.folder) {
    try {
      const f = await gjson(`${API}/files/${encodeURIComponent(ids.folder)}?fields=id,trashed`);
      if (f && !f.trashed) return ids.folder;
    } catch { /* look it up again */ }
  }
  const found = await findChild('root', ROOT_FOLDER, FOLDER);
  const id = found ? found.id : (await gjson(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: ROOT_FOLDER, mimeType: FOLDER, parents: ['root'] }),
  })).id;
  ids = { folder: id };
  saveIds(ids);
  return id;
}

// When the data file last changed (cheap: no download). Null when there is no file yet.
export async function dataVersion() {
  if (!ids.file) return null;
  try {
    const f = await gjson(`${API}/files/${encodeURIComponent(ids.file)}?fields=id,modifiedTime,trashed`);
    if (f.trashed) { ids.file = ''; saveIds(ids); return null; }
    return f.modifiedTime;
  } catch (err) {
    if (err.code === 'not-connected') throw err;
    ids.file = ''; saveIds(ids);
    return null;
  }
}

// Reads the data file: { data, version } or { data: null } when it doesn't exist yet.
export async function readData() {
  if (!ids.file) {
    const folder = await folderId();
    const f = await findChild(folder, DATA_FILE);
    if (!f) return { data: null, version: null };
    ids.file = f.id;
    saveIds(ids);
  }
  const meta = await gjson(`${API}/files/${encodeURIComponent(ids.file)}?fields=id,modifiedTime,trashed`).catch((err) => {
    if (err.code === 'not-connected') throw err;
    return null;
  });
  if (!meta || meta.trashed) { ids.file = ''; saveIds(ids); return readData(); }
  const res = await gfetch(`${API}/files/${encodeURIComponent(ids.file)}?alt=media`);
  if (!res.ok) throw new Error(`Couldn't read the Family Hub file in Drive (${res.status}).`);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { data, version: meta.modifiedTime };
}

// Writes the data file (creating it the first time). Returns the new version.
export async function writeData(data) {
  const body = JSON.stringify(data);
  if (!ids.file) {
    const folder = await folderId();
    const existing = await findChild(folder, DATA_FILE);
    ids.file = existing ? existing.id : (await gjson(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: DATA_FILE, mimeType: 'application/json', parents: [folder] }),
    })).id;
    saveIds(ids);
  }
  const f = await gjson(`${UPLOAD}/files/${encodeURIComponent(ids.file)}?uploadType=media&fields=id,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body,
  });
  return f.modifiedTime;
}

export function folderLink() { return ids.folder ? `https://drive.google.com/drive/folders/${ids.folder}` : 'https://drive.google.com/'; }
