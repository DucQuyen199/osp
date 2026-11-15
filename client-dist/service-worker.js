const CACHE_NAME = 'osp-shell-v1';
const SHELL_FILES = [
  '/',
  '/manifest.webmanifest',
  '/app/favicon.svg',
  '/app/icon.svg',
  '/app/icon-192.png',
  '/app/icon-512.png',
  '/app/styles/tokens.css',
  '/app/styles/base.css',
  '/app/styles/components.css',
  '/app/styles/layout.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES);
    const index = await cache.match('/');
    const html = index ? await index.text() : '';
    const entryAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    if (entryAssets.length) await cache.addAll([...new Set(entryAssets)]);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('osp-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put('/', response.clone());
        return response;
      } catch {
        return (await cache.match('/')) || new Response('OSP Suite is offline. Reconnect to continue.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  const isAppAsset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/app/');
  if (!isAppAsset && url.pathname !== '/manifest.webmanifest') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
