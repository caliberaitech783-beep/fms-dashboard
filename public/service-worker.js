const CACHE_VERSION = "cmll-fms-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const STATIC_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isSensitiveRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith("/api/")
    || url.pathname.includes("/auth/")
    || request.headers.has("authorization")
    || request.method !== "GET";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (isSensitiveRequest(request)) return;

  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.origin === self.location.origin && (url.pathname.startsWith("/assets/") || STATIC_ASSETS.includes(url.pathname))) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => (
        cache.match(request).then((cached) => cached || fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }))
      )),
    );
  }
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "CMLL FMS";
  const options = {
    body: data.body || "You have a new notification.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || data.notificationId || "cmll-fms",
    data: {
      notificationId: data.notificationId || "",
      deepLinkUrl: data.deepLinkUrl || "/?section=notifications",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.deepLinkUrl || "/?section=notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const sameOriginClient = clients.find((client) => client.url.startsWith(self.location.origin));
      if (sameOriginClient) {
        sameOriginClient.focus();
        sameOriginClient.navigate(targetUrl);
        return;
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

