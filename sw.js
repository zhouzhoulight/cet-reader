const CACHE_NAME = "cet-reader-cache-v2026-06-04-2";
const CACHE_PREFIX = "cet-reader-cache";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./data/builtin-index.json",
  "./data/0529.json",
  "./data/0530.json",
  "./data/0601.json",
  "./data/0602.json",
  "./data/0603.json",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((error) => console.warn("[CET Reader SW] install cache failed", error))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHtml = request.mode === "navigate" || request.destination === "document";
  const isStatic = ["script", "style", "manifest", "image"].includes(request.destination)
    || /\.(?:js|css|json|svg)$/i.test(url.pathname);

  if (isHtml) {
    event.respondWith(networkFirst(request));
  } else if (isStatic) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request))
      || (await cache.match("./index.html"))
      || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());
  return cached || update;
}
