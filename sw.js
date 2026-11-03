const CACHE_NAME = 'mind-walkman-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './public/icons/icon-192.png',
  './public/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Audio range requests handling for iOS Safari AVFoundation
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request, { ignoreSearch: true });

        // If not cached, fetch from network and opportunistically cache full 200 response
        if (!cachedResponse) {
          try {
            const networkResponse = await fetch(request);
            if (networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          } catch (err) {
            return new Response('Network error and no cache available', { status: 503 });
          }
        }

        const rangeHeader = request.headers.get('range');
        if (!rangeHeader) {
          return cachedResponse;
        }

        // Parse Range: bytes=start-end
        const arrayBuffer = await cachedResponse.arrayBuffer();
        const totalSize = arrayBuffer.byteLength;
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

        if (start >= totalSize || end >= totalSize) {
          return new Response('', {
            status: 416,
            statusText: 'Range Not Satisfiable',
            headers: { 'Content-Range': `bytes */${totalSize}` }
          });
        }

        const slicedBuffer = arrayBuffer.slice(start, end + 1);
        return new Response(slicedBuffer, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(slicedBuffer.byteLength),
            'Content-Type': 'audio/mpeg'
          }
        });
      })()
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        if (response.status === 200) {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, resClone));
        }
        return response;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
