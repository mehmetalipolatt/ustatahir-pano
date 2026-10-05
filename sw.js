// Ustatahir Konutları: çevrimdışı açılış için basit önbellek.
// Önce ağdan alır (her zaman en güncel sürüm), ağ yoksa son kaydedilen sürümü gösterir.
// Yalnızca bu sitenin kendi dosyaları önbelleğe alınır; Firebase verileri hiç önbelleğe girmez.
const CACHE = 'ustatahir-v7';
const CORE = ['./', './index.html', './sahne.js', './manifest.webmanifest', './img/icon-192.png', './img/site-giris.jpg', './img/site-giris-genis.jpg', './img/site-giris-bulanik.jpg', './img/site-baslik.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
