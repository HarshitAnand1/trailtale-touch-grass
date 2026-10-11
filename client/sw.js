/**
 * Trailtale Service Worker
 * Caches the app shell for offline use. The app must work with zero network.
 */

const CACHE_NAME = 'trailtale-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/walk-gate.js',
  '/audio-queue.js',
  '/quest-ui.js',
  '/manifest.json',
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for shell assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API and audio: try network first, fall back to cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/audio/')) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          // Cache audio files for offline playback
          if (url.pathname.startsWith('/audio/') && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Shell assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
