// Sevenday Bike Fit service worker: lets the web app open offline. Works at "/" (desktop dev) and "/fit/" (website).
const CACHE = 'sevenday-fit-v2';
const SCOPE = new URL(self.registration.scope).pathname; // e.g. "/fit/"
const MODEL_HOST = 'storage.googleapis.com';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll([SCOPE, SCOPE + 'manifest.webmanifest']))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sevenday') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // sync always goes to the network
  const mine = url.origin === self.location.origin && url.pathname.startsWith(SCOPE);
  if (req.mode === 'navigate' && mine) {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(SCOPE, c)); return r; })
      .catch(() => caches.match(SCOPE)));
    return;
  }
  const rel = mine ? url.pathname.slice(SCOPE.length) : '';
  const cacheFirst = (mine && /^(assets|mediapipe|icons|models)\//.test(rel)) || url.hostname === MODEL_HOST;
  if (!cacheFirst) return;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return r;
  })));
});
