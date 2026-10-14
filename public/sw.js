// Trailmate notification worker.
// Its ONLY job is to show a phone notification for an alert the app raised, and to bring Trailmate to the front when it is tapped.
// It does not cache pages, does not intercept network requests and does not receive push messages from a server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
