// Service Worker — runtime cache for ExifTool WASM/JS chunks fetched from
// esm.sh (and any .wasm asset). First visit pays the cost; subsequent
// visits boot in milliseconds.

const CACHE_NAME = 'exif-frame-exiftool-v1';

// Match anything that looks like an exiftool-related asset.
const SHOULD_CACHE = (url) => (
  /esm\.sh\/.*exiftool/i.test(url)
  || /esm\.sh\/.*zeroperl/i.test(url)
  || /\.wasm(\?|$)/.test(url)
);

self.addEventListener('install', (event) => {
  // Skip waiting so an updated SW activates without a refresh.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clean up older caches if we ever bump CACHE_NAME.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!SHOULD_CACHE(request.url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      // Don't cache opaque or partial responses.
      if (fresh && fresh.status === 200) {
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      // Offline + nothing cached: surface the failure to the caller.
      if (cached) return cached;
      throw err;
    }
  })());
});
