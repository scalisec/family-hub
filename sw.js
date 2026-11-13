// Family Hub offline helper. Always asks GitHub for the newest copy of the app's own files
// (a quick "has it changed?" check), and falls back to the saved copy when there's no signal,
// so the app still opens offline. It never touches Google, the helper, or the weather.
const CACHE = 'fh-shell-3.2.0';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'css/app.css', 'js/app.js'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // no-cache: check with GitHub every time instead of trusting the browser's 10-minute copy.
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || new Response('Offline', { status: 503 });
    }
  })());
});
