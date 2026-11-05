/* Family Hub PWA shell. Never persist private API responses or credentials. */
const CACHE_NAME = 'family-hub-shell-v1';
const OFFLINE_URL = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([OFFLINE_URL, '/icons/icon-192.png'])));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('family-hub-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/qa') || request.headers.has('Authorization')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
