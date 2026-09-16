// Kill switch temporário do PWA para eliminar caches antigos presos no navegador.
const RESET_VERSION = '20260916-1';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();

    const clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    await Promise.all(clients.map(async client => {
      try {
        const url = new URL(client.url);
        if (url.origin !== self.location.origin) return;
        if (url.pathname.startsWith('/api/')) return;
        url.searchParams.set('pwa_reset', RESET_VERSION);
        await client.navigate(url.toString());
      } catch (_) {}
    }));
  })());
});

// Nenhuma requisição é interceptada nesta fase de recuperação.
self.addEventListener('fetch', () => {});
