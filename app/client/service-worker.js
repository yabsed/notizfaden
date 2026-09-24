// Only the application shell is cached. API responses and other people's notes
// are always fetched from the server so a visibility change is rechecked.
const CACHE = '__CACHE_NAME__';
const PRECACHE = __PRECACHE__;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('teum-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put('/', copy)); } return response; }).catch(() => caches.match('/')));
  } else if ((/^\/(assets|fonts)\//.test(url.pathname) || url.pathname === '/icon.svg')) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request, { ignoreVary: true })).then(cached => cached || fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; })));
  }
});
