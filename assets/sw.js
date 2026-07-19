const CACHE_VERSION = "v9-wizard-improved";
const CACHE_NAME = `quanto-${CACHE_VERSION}`;
const SCOPE = new URL('.', self.location).pathname;

self.addEventListener("install", (event) => {
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

  const isJsOrCss = request.url.endsWith('.js') || request.url.endsWith('.css');
  const isHtmlOrManifest = request.url.endsWith('.html') || request.url.endsWith('manifest.json') || request.url.endsWith('/');

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return networkResponse;
        }
        return networkResponse;
      } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        if (request.destination === "document") {
          return caches.match(SCOPE + 'index.html');
        }
        throw error;
      }
    })()
  );
});
