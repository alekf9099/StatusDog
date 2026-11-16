/**
 * StatusDog's service worker — what makes the site installable as an app, and
 * lets it open without a connection.
 *
 * Network first, always: a monitoring site must never show yesterday's page as
 * if it were today's, so the cache is only a fallback for when the network is
 * gone, and every successful page or asset load refreshes it. API responses are
 * never cached here at all — a status read from the cache would be a lie — and
 * the page itself says when it is offline (see assets/watch.js).
 */
const CACHE = 'statusdog-v1';
const SHELL = ['/', '/office', '/status', '/assets/statusdog.css', '/assets/office.css', '/assets/app/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // A shell that fails to cache only costs offline support, never the install.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
        if (cached) return cached;
        if (request.mode === 'navigate') return (await caches.match('/')) ?? Response.error();
        return Response.error();
      }),
  );
});
