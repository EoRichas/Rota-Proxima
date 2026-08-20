const CACHE='rota-proxima-render-performance-20260820-v1';
const ASSETS=['/','/index.html','/styles.css','/workflow-patch.css','/dashboard-center.css','/ui-cleanup.css','/mobile-access.css','/app.js','/workflow-patch.js','/dashboard-center.js','/ui-cleanup.js','/mobile-access.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')) return;
  if(e.request.mode==='navigate'){
    e.respondWith(caches.match('/index.html').then(cached=>{
      const refresh=fetch(e.request).then(response=>{
        if(response.ok)caches.open(CACHE).then(cache=>cache.put('/index.html',response.clone()));
        return response;
      });
      if(cached){e.waitUntil(refresh.catch(()=>{}));return cached;}
      return refresh;
    }));
    return;
  }
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(cached=>{
    const refresh=fetch(e.request).then(response=>{
      if(response.ok)caches.open(CACHE).then(cache=>cache.put(e.request,response.clone()));
      return response;
    });
    if(cached){e.waitUntil(refresh.catch(()=>{}));return cached;}
    return refresh;
  }));
});
