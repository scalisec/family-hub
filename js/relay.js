// Talks to the background helper (Google Apps Script running as the owner).
// Every request carries the owner's Google sign-in, which the helper checks with Google.
import { RELAY_URL } from './config.js';
import { currentToken, NotConnectedError } from './google.js';

export async function relay(action, data = {}) {
  const token = currentToken();
  if (!token) throw new NotConnectedError();
  let res;
  try {
    // text/plain keeps this a "simple" request, which Apps Script accepts from another site.
    res = await fetch(RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, action, data }) });
  } catch {
    throw new Error("Couldn't reach the Family Hub helper. Check your connection.");
  }
  if (!res.ok) throw new Error(`The Family Hub helper said ${res.status}.`);
  let body;
  try { body = await res.json(); } catch { throw new Error('The Family Hub helper needs a one-time approval. See More > Help.'); }
  if (!body.ok) {
    if (body.code === 'signin') throw new NotConnectedError(body.error);
    throw new Error(body.error || 'The Family Hub helper had a problem.');
  }
  return body;
}

export function wallLink(key) {
  return key ? new URL(`wall.html#k=${key}`, new URL('../', import.meta.url)).href : '';
}

export async function wallFeed(key) {
  const res = await fetch(`${RELAY_URL}?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Feed returned ${res.status}`);
  return res.json();
}
