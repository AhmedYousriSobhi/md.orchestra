// Minimal offline/app-shell cache. Deliberately narrow in scope: it only
// caches same-origin GET requests (this app's own HTML/CSS/JS), leaving the
// CDN-hosted libraries (markdown-it, highlight.js, mermaid, DOMPurify) and
// the Claude API to the network and the browser's own HTTP cache — caching
// cross-origin responses here would mean opaque responses we can't safely
// reason about, for no real benefit (those URLs are already versioned/pinned
// and cache well on their own).
const CACHE_NAME = 'md-dashboard-v1';
const PRECACHE = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Stale-while-revalidate: answer from cache immediately when we have it (so
// the app still opens offline / right after a crash), while refreshing the
// cache from the network in the background for next time.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
