const CACHE_NAME = "cet-reader-cache-v2026-06-06-redesign-assets-1";
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
  "./data/0604.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/logo-mark.svg",
  "./icons/logo-horizontal.svg",
  "./assets/onboarding/onboarding-1.svg",
  "./assets/onboarding/onboarding-2.svg",
  "./assets/onboarding/onboarding-3.svg",
  "./assets/empty/empty-learning.svg",
  "./assets/empty/empty-favorites.svg",
  "./assets/empty/empty-plan.svg",
  "./assets/empty/empty-data.svg",
  "./assets/badges/streak-7.svg",
  "./assets/badges/streak-30.svg",
  "./assets/badges/learn-100.svg",
  "./assets/badges/favorite-master.svg",
  "./assets/badges/review-pro.svg",
  "./assets/badges/persistence.svg",
  "./assets/ui/trophy.svg",
  "./assets/ui/progress-card-deco.svg",
  "./assets/ui/study-plan-deco.svg",
  "./assets/icons/home.svg",
  "./assets/icons/learn.svg",
  "./assets/icons/library.svg",
  "./assets/icons/stats.svg",
  "./assets/icons/profile.svg",
  "./assets/icons/play.svg",
  "./assets/icons/pause.svg",
  "./assets/icons/next.svg",
  "./assets/icons/prev.svg",
  "./assets/icons/repeat.svg",
  "./assets/icons/favorite.svg",
  "./assets/icons/difficult.svg",
  "./assets/icons/mastered.svg",
  "./assets/icons/remove.svg",
  "./assets/icons/settings.svg",
  "./assets/icons/search.svg",
  "./assets/icons/filter.svg",
  "./assets/icons/calendar.svg",
  "./assets/icons/import.svg",
  "./assets/icons/backup.svg",
  "./assets/icons/more.svg",
  "./assets/icons/speaker.svg",
  "./assets/icons/mic.svg",
  "./assets/icons/note.svg",
  "./assets/icons/refresh.svg"
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHtml = request.mode === "navigate" || request.destination === "document";
  const isStatic = ["script", "style", "manifest", "image"].includes(request.destination)
    || /\.(?:js|css|json|svg|png|mp3)$/i.test(url.pathname);

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
