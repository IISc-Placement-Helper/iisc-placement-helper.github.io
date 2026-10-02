// Service worker. The shell is precached and served cache-first as one versioned set, so index.html always
// matches the SRI hashes of the scripts beside it; the deploy workflow renames V for every new build.
// vendor/ is cached on first use; the feed is network-first, falling back to the last copy when offline.
const V = 'hq-dev', SHELL = ['./', 'app.js', 'core.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));

const keep = (key, res) => { if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(key, copy)); } return res; };
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/feed.enc.json')) return e.respondWith(fetch(req).then(r => keep(url.pathname, r)).catch(() => caches.match(url.pathname)));
  if (req.mode === 'navigate') return e.respondWith(caches.match('./').then(hit => hit || fetch(req)));
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => keep(req, r))));
});
