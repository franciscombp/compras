const CACHE_VERSION = "v1";
const CACHE_NAME = `quanto-${CACHE_VERSION}`;
const SCOPE = new URL('.', self.location).pathname;
const ASSETS_TO_CACHE = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'assets/app.js',
  SCOPE + 'assets/tokens.css',
  SCOPE + 'data/store.js',
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("Cache initial assets error:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith("quanto-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((response) => {
      if (response) return response;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return response;
      });
    })
    .catch(() => {
      if (request.destination === "document") {
        return caches.match("/quanto/index.html");
      }
    })
  );
});
