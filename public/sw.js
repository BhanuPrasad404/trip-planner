// Trailmate service worker. It does two small things, and nothing else:
//   1. Shows a phone notification for an alert the app raised, and brings Trailmate to the front when it is tapped.
//   2. When opening a PAGE fails because the device has no connection, shows a friendly offline page (/offline.html) instead of the
//      browser's error screen.
// It does NOT cache app pages or data, does NOT answer API calls, and does NOT receive push messages from a server. Caching signed-in
// pages would risk showing one person's data to another on a shared device, or stale trips; that needs its own design and approval.
// Bump OFFLINE_CACHE when /offline.html changes.
const OFFLINE_CACHE = "trailmate-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => undefined) // an install that cannot pre-load the offline page still works for notifications
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("trailmate-offline-") && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .catch(() => undefined)
      .then(() => self.clients.claim())
  );
});

// Only top-level page navigations are touched. Everything else (API calls, scripts, images, map tiles) goes to the network untouched.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate" || req.method !== "GET") return;
  event.respondWith(
    fetch(req).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  // Only ever open a page on this same site: a relative path, never "//elsewhere.example".
  const url = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) if ("focus" in w) return w.focus();
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    })
  );
});
