/* CYP FIN: keeps the app on the phone so it opens without internet. Change VERSION at every update. */
var VERSION = 'cyp-fin-beta-1.10';
var FILES = ['./', 'index.html', 'core.js', 'budget.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-48.png', 'ds/tokens.css', 'ds/bundle.css', 'ds/icons.js', 'ds/cyp-fin.svg', 'ds/cyp-seal.png', 'ds/fonts/Ubuntu-Medium.woff2', 'ds/fonts/Ubuntu-Bold.woff2', 'ds/fonts/OpenSans-Regular.woff2', 'ds/fonts/OpenSans-Bold.woff2'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; /* the database is never kept here */
  /* newest first when there is internet, the kept copy when there is none */
  e.respondWith(fetch(req).then(function (res) { if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); } return res; }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); }); }));
});
