/* PWA com atualização segura: APIs sempre passam pela rede; a tela de login
   nunca fica presa em uma cópia antiga do cache. */
const CACHE_NAME = 'rota-proxima-shell-20260924-agenda';
const INDEX_CACHE_KEY = '/index.html';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApi(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request, {cache: 'no-store'});
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(INDEX_CACHE_KEY, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await caches.match(INDEX_CACHE_KEY);
    if (cached) return cached;
    throw _;
  }
}

async function cacheVersionedAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url) || isApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Only immutable, versioned assets use the cache. Unversioned files remain
  // network-first so a deploy can replace them immediately.
  if (url.searchParams.has('v')) event.respondWith(cacheVersionedAsset(request));
});
