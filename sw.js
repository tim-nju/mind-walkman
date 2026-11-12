const CACHE_NAME = 'mind-walkman-shell-v16';
const STATIC_ASSETS = ['./', './index.html', './listen.html', './styles.css?v=16', './tracks.js?v=16', './course-data.js?v=16', './storage.js?v=16', './controls.js?v=16', './importer.js?v=16', './app.js?v=16', './sealed-media.js?v=16', './private-delivery.js?v=16', './sync-model.js', './sync-client.js', './sync-store.js', './sync-transport.js', './sync-player.js', './sync-ui.js', './sync.css', './manifest.json', './public/icons/icon-192.png', './public/icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS.map(asset => new Request(asset, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  // Keep v2 media cache: existing offline recordings must survive an upgrade.
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mind-walkman-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
async function mediaResponse(request) {
  const cached = await caches.match(new Request(request.url));
  if (!cached) {
    const url = new URL(request.url);
    if (/\/audio\/(daodejing|hope|scripture|diamond)\//.test(url.pathname) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Response('请从 iCloud 文件夹导入课程', { status: 404 });
    try { return await fetch(request); }
    catch (error) { if (error instanceof Error) return new Response('音频未缓存', { status: 503 }); throw error; }
  }
  const range = request.headers.get('range');
  if (!range) return cached;
  const bytes = await cached.arrayBuffer();
  const total = bytes.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), total - 1) : total - 1) : total - 1;
  if (start >= total || end < start || (!match[1] && Number(match[2]) === 0)) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
    'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes', 'Content-Type': cached.headers.get('content-type') || (request.url.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg')
  } });
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (/\.(mp3|m4a)$/.test(new URL(request.url).pathname)) { event.respondWith(mediaResponse(request)); return; }
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(request);
    if (cached) return cached;
    try { return await fetch(request); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      if (request.mode === 'navigate') return (await cache.match('./index.html')) || new Response('应用未缓存', { status: 503 });
      return new Response('资源未缓存', { status: 503 });
    }
  }));
});
