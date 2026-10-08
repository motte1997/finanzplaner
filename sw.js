/* Service Worker: App-Shell offline verfügbar. Die GitHub-API wird NIE gecacht. */
const CACHE = "finanzplaner-shell-v2";   // bei App-Updates hochzählen (v2, v3, …)
const SHELL = ["./", "./index.html", "./app.js", "./chart.min.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // API etc. unberührt
  // Stale-while-revalidate: sofort aus Cache, im Hintergrund aktualisieren
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
