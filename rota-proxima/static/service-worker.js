const CACHE='rota-proxima-cassola-login-20260915-v5';
const ASSETS=['/','/index.html','/styles.css','/workflow-patch.css','/dashboard-center.css','/ui-cleanup.css','/mobile-access.css','/ui-enhancements.css','/fluid-design.css','/cassola-login.css','/cassola-login-reference.css','/cassola-login-hero.webp','/app.js','/workflow-patch.js','/dashboard-center.js','/ui-cleanup.js','/mobile-access.js','/status-location-patch.js','/ui-enhancements.js','/manifest.webmanifest','/icon.svg','/cassola-logo.jpeg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')) return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(response=>{
      if(response.ok)caches.open(CACHE).then(cache=>cache.put('/index.html',response.clone()));
      return response;
    }).catch(()=>caches.match('/index.html')));
    return;
  }
  e.respondWith(fetch(e.request).then(response=>{
    if(response.ok)caches.open(CACHE).then(cache=>cache.put(e.request,response.clone()));
    return response;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
