// Service Worker for OpsDec PWA
const CACHE_NAME = 'opsdec-v2';
const IMAGE_CACHE_NAME = 'opsdec-images-v1';
const IMAGE_CACHE_MAX_ENTRIES = 500;

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  const validCaches = [CACHE_NAME, IMAGE_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !validCaches.includes(name))
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Trim image cache to max entries (LRU-style: oldest inserted are removed first)
async function trimImageCache() {
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length > IMAGE_CACHE_MAX_ENTRIES) {
    const toDelete = keys.length - IMAGE_CACHE_MAX_ENTRIES;
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// Fetch event
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip WebSocket and API requests (but NOT /proxy/image)
  if (event.request.url.includes('/ws') ||
      (event.request.url.includes('/api/') && !event.request.url.includes('/api/auth/avatar/'))) {
    return;
  }

  // Skip cross-origin requests — only cache same-origin assets
  if (new URL(event.request.url).origin !== self.location.origin) return;

  // Cache-first for proxy images and avatars
  if (event.request.url.includes('/proxy/image') || event.request.url.includes('/api/auth/avatar/')) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
              trimImageCache();
            }
            return response;
          }).catch(() => new Response('', { status: 503 }));
        });
      })
    );
    return;
  }

  // Network-first for other static assets
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for static assets
        if (response.ok && event.request.url.match(/\.(js|css|png|svg|ico|woff2?)$/)) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request).then((cached) => cached || new Response('', { status: 503 }));
      })
  );
});
