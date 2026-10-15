import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "@/app/api/ping/route";
import { config } from "@/proxy";
import { offlineCopy, recoveryCopy, shouldRefreshAfter, STALE_AFTER_MS } from "@/lib/client/offline-copy";

describe("GET /api/ping", () => {
  it("is an instant, empty, never-cached 204 (it reveals nothing and costs nothing)", async () => {
    for (const r of [GET(), HEAD()]) {
      expect(r.status).toBe(204);
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(await r.text()).toBe("");
    }
  });
});

describe("proxy matcher", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  it("does not run the session refresh for the ping, the service worker or the offline page", () => {
    for (const p of ["/api/ping", "/sw.js", "/offline.html"]) expect(re.test(p), p).toBe(false);
  });
  it("still runs for pages and other API routes", () => {
    for (const p of ["/trips", "/trips/abc/plan", "/api/places", "/api/pingpong", "/login"]) expect(re.test(p), p).toBe(true);
  });
});

// Run the real public/sw.js in a sandbox with a fake service-worker scope.
function loadWorker(opts: { cached?: Response | undefined; failInstall?: boolean } = {}) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Response>(opts.cached ? [["/offline.html", opts.cached]] : []);
  const caches = {
    open: vi.fn(async () => ({ add: vi.fn(async () => { if (opts.failInstall) throw new Error("offline during install"); }) })),
    keys: vi.fn(async () => ["trailmate-offline-v0", "trailmate-offline-v1", "someone-elses-cache"]),
    delete: vi.fn(async () => true),
    match: vi.fn(async (u: string) => store.get(u)),
  };
  const self = { addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; }, skipWaiting: vi.fn(), clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []), openWindow: vi.fn() } };
  const fetchMock = vi.fn();
  const ctx = vm.createContext({ self, caches, fetch: fetchMock, Request, Response, console, Promise });
  vm.runInContext(readFileSync("public/sw.js", "utf8"), ctx);
  return { listeners, caches, self, fetchMock };
}
const navEvent = (mode: string, method = "GET") => { let responded: Promise<Response> | null = null; return { request: { mode, method, url: "/trips" }, respondWith: (p: Promise<Response>) => { responded = p; }, get responded() { return responded; } }; };

describe("public/sw.js: offline fallback for page navigations", () => {
  it("serves the cached offline page when a page navigation cannot reach the network", async () => {
    const w = loadWorker({ cached: new Response("OFFLINE PAGE", { status: 200 }) });
    w.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const e = navEvent("navigate"); w.listeners.fetch(e);
    expect(await (await e.responded!).text()).toBe("OFFLINE PAGE");
  });
  it("passes a successful navigation through untouched", async () => {
    const w = loadWorker({ cached: new Response("OFFLINE PAGE") });
    w.fetchMock.mockResolvedValue(new Response("REAL PAGE"));
    const e = navEvent("navigate"); w.listeners.fetch(e);
    expect(await (await e.responded!).text()).toBe("REAL PAGE");
  });
  it("falls back to a plain 503 when the offline page was never cached, instead of a browser error", async () => {
    const w = loadWorker(); w.fetchMock.mockRejectedValue(new TypeError("x"));
    const e = navEvent("navigate"); w.listeners.fetch(e);
    expect((await e.responded!).status).toBe(503);
  });
  it("never intercepts API calls, scripts, images or non-GET requests", () => {
    const w = loadWorker();
    for (const [mode, method] of [["cors", "GET"], ["no-cors", "GET"], ["same-origin", "POST"], ["navigate", "POST"]] as const) {
      const e = navEvent(mode, method); w.listeners.fetch(e);
      expect(e.responded, `${mode} ${method}`).toBeNull();
    }
    expect(w.fetchMock).not.toHaveBeenCalled();
  });
  it("installs even if the offline page cannot be pre-loaded (notifications must keep working)", async () => {
    const w = loadWorker({ failInstall: true });
    let done: Promise<unknown> = Promise.resolve(); w.listeners.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });
  it("on activate removes only OLD Trailmate offline caches, never anyone else's", async () => {
    const w = loadWorker(); let done: Promise<unknown> = Promise.resolve(); w.listeners.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(w.caches.delete).toHaveBeenCalledTimes(1);
    expect(w.caches.delete).toHaveBeenCalledWith("trailmate-offline-v0");
    expect(w.self.clients.claim).toHaveBeenCalled();
  });
  it("still opens only same-site pages when a notification is tapped (existing safety rule kept)", async () => {
    const w = loadWorker(); const close = vi.fn(); let done: Promise<unknown> = Promise.resolve();
    w.listeners.notificationclick({ notification: { close, data: { url: "//evil.example" } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(close).toHaveBeenCalled();
    expect(w.self.clients.openWindow).toHaveBeenCalledWith("/");
  });
});

describe("public/offline.html", () => {
  const html = readFileSync("public/offline.html", "utf8");
  it("is self-contained (no network resources) so it can be shown with no network", () => {
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });
  it("is accessible: language, status region, labelled button, reduced-motion respected", () => {
    expect(html).toContain('<html lang="en">'); expect(html).toContain('role="status"'); expect(html).toContain("prefers-reduced-motion"); expect(html).toContain("<button");
  });
  it("retries by itself through the ping route and reloads only when the server answers", () => {
    expect(html).toContain("/api/ping"); expect(html).toContain("location.reload()"); expect(html).toContain('"online"');
  });
});

describe("offline copy", () => {
  it("says what still works and what is paused, with a countdown when one is known", () => {
    expect(offlineCopy({ checking: false, secondsToRetry: 8, failures: 1 }).detail).toMatch(/still here.*paused.*8 s/);
    expect(offlineCopy({ checking: true, secondsToRetry: null, failures: 1 }).detail).toBe("Checking the connection…");
    expect(offlineCopy({ checking: false, secondsToRetry: null, failures: 1 }).detail).toMatch(/paused until you're back online/);
  });
  it("changes the title after repeated failures", () => {
    expect(offlineCopy({ checking: false, secondsToRetry: 3, failures: 1 }).title).toBe("You're offline");
    expect(offlineCopy({ checking: false, secondsToRetry: 3, failures: 6 }).title).toBe("Still offline");
  });
  it("refreshes server data only after an outage long enough to have made it stale", () => {
    expect(shouldRefreshAfter(STALE_AFTER_MS - 1)).toBe(false); expect(shouldRefreshAfter(STALE_AFTER_MS)).toBe(true);
    expect(recoveryCopy(2_000).detail).toBe(""); expect(recoveryCopy(60_000).detail).toMatch(/Updating/);
  });
});
