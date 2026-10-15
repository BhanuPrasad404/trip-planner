import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRM_MS, HEARTBEAT_MS, MISSES_TO_OFFLINE, RETRY_FIRST_MS, RETRY_MAX_MS, OfflineError, createConnectivity, guardedFetch, isGuardedRequest, isOfflineError, makeProbe, retryDelay,
  type ConnectivityDeps,
} from "@/lib/client/connectivity";

// A tiny harness: a controllable network, browser flag and tab visibility on top of fake timers.
function harness(opts: { browserOnline?: boolean; visible?: boolean; reachable?: boolean } = {}) {
  const world = { browserOnline: opts.browserOnline ?? true, visible: opts.visible ?? true, reachable: opts.reachable ?? true, probes: 0 };
  const deps: ConnectivityDeps = {
    probe: async () => { world.probes++; return world.reachable; },
    now: () => Date.now(),
    browserOnline: () => world.browserOnline,
    pageVisible: () => world.visible,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    random: () => 0.5, // jitter factor exactly 1
  };
  const c = createConnectivity(deps);
  return { c, world };
}
const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T10:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("connectivity: starting up", () => {
  it("starts online when the browser says online, and does not probe until the heartbeat", async () => {
    const { c, world } = harness();
    c.start();
    expect(c.getSnapshot().status).toBe("online");
    await flush(HEARTBEAT_MS - 1);
    expect(world.probes).toBe(0);
    await flush(2);
    expect(world.probes).toBe(1);
    expect(c.getSnapshot().status).toBe("online");
  });
  it("starts offline at once when the browser already says offline (airplane mode) and keeps checking", async () => {
    const { c, world } = harness({ browserOnline: false, reachable: false });
    c.start();
    expect(c.getSnapshot().status).toBe("offline");
    await flush(0);
    expect(world.probes).toBe(1);
  });
  it("start() twice does not double the timers", async () => {
    const { c, world } = harness();
    c.start(); c.start();
    await flush(HEARTBEAT_MS + 1);
    expect(world.probes).toBe(1);
  });
});

describe("connectivity: going offline", () => {
  it("believes the browser's own offline event immediately", async () => {
    const { c, world } = harness(); c.start();
    world.reachable = false;
    c.browserOffline();
    expect(c.getSnapshot().status).toBe("offline");
    expect(c.getSnapshot().recovery).toBeNull();
  });
  it("one failed request does NOT flip to offline; a second miss does", async () => {
    const { c, world } = harness(); c.start();
    world.reachable = false;
    c.requestFailed();
    await flush(0);
    expect(c.getSnapshot().status).toBe("online");
    expect(c.getSnapshot().failures).toBe(1);
    await flush(CONFIRM_MS + 1);
    expect(c.getSnapshot().failures).toBe(MISSES_TO_OFFLINE);
    expect(c.getSnapshot().status).toBe("offline");
  });
  it("a failed request followed by a successful probe changes nothing (a dropped packet is not a disconnection)", async () => {
    const { c, world } = harness(); c.start();
    c.requestFailed();                       // network is actually fine
    await flush(0);
    expect(c.getSnapshot().status).toBe("online");
    expect(c.getSnapshot().failures).toBe(0);
    expect(world.probes).toBe(1);
  });
  it("notices Wi-Fi-with-no-internet with no user action: the heartbeat probe fails twice", async () => {
    const { c, world } = harness(); c.start();
    world.reachable = false; // the browser still says online
    await flush(HEARTBEAT_MS + 1);
    expect(c.getSnapshot().status).toBe("online");
    await flush(CONFIRM_MS + 1);
    expect(c.getSnapshot().status).toBe("offline");
  });
  it("requestFailed while already offline does not start extra probes", async () => {
    const { c, world } = harness({ browserOnline: false, reachable: false }); c.start(); await flush(0);
    const before = world.probes;
    c.requestFailed(); c.requestFailed();
    await flush(0);
    expect(world.probes).toBe(before);
  });
});

describe("connectivity: coming back", () => {
  it("the browser's online event is only a hint: it probes, and says online only when the probe succeeds", async () => {
    const { c, world } = harness({ browserOnline: false, reachable: false }); c.start(); await flush(0);
    world.browserOnline = true;
    c.browserOnline(); await flush(0);
    expect(c.getSnapshot().status).toBe("offline"); // the hint was wrong (captive portal)
    world.reachable = true;
    await flush(RETRY_MAX_MS + 1);
    expect(c.getSnapshot().status).toBe("online");
  });
  it("records how long the outage lasted and offers a one-time recovery message", async () => {
    const { c, world } = harness(); c.start();
    world.reachable = false; c.browserOffline(); await flush(0);
    await flush(45_000);
    world.reachable = true;
    await c.retryNow();
    const snap = c.getSnapshot();
    expect(snap.status).toBe("online");
    expect(snap.recovery).not.toBeNull();
    expect(snap.recovery!.offlineMs).toBeGreaterThanOrEqual(45_000);
    c.acknowledgeRecovery();
    expect(c.getSnapshot().recovery).toBeNull();
  });
  it("an outage never reported (healthy checks only) leaves no recovery message", async () => {
    const { c } = harness(); c.start();
    await flush(HEARTBEAT_MS * 3);
    expect(c.getSnapshot().recovery).toBeNull();
  });
  it("retries with growing pauses while offline, and stays under the cap", async () => {
    const { c, world } = harness({ browserOnline: false, reachable: false }); c.start(); await flush(0);
    const seen: number[] = [];
    let last = world.probes;
    for (let i = 0; i < 8; i++) {
      const t0 = Date.now();
      while (world.probes === last) await flush(500);
      seen.push(Date.now() - t0); last = world.probes;
    }
    expect(seen[0]).toBeGreaterThanOrEqual(RETRY_FIRST_MS - 500);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(RETRY_MAX_MS + 500);
    expect(seen[3]).toBeGreaterThan(seen[0]);
  });
  it("'Try again' probes immediately and shares an in-flight probe instead of starting two", async () => {
    const { c, world } = harness({ browserOnline: false, reachable: false }); c.start();
    await flush(0);
    const before = world.probes;
    const a = c.retryNow(); const b = c.retryNow();
    await Promise.all([a, b]);
    expect(world.probes - before).toBe(1);
  });
  it("exposes when the next automatic retry will happen", async () => {
    const { c } = harness({ browserOnline: false, reachable: false }); c.start(); await flush(0);
    const next = c.getSnapshot().nextRetryAt;
    expect(next).not.toBeNull();
    expect(next! - Date.now()).toBeGreaterThan(0);
    expect(next! - Date.now()).toBeLessThanOrEqual(RETRY_MAX_MS);
  });
});

describe("connectivity: hidden tabs and shutdown", () => {
  it("does not probe while the tab is hidden, and checks again the moment it is shown", async () => {
    const { c, world } = harness({ visible: false }); c.start();
    await flush(HEARTBEAT_MS * 3);
    expect(world.probes).toBe(0);
    world.visible = true; c.pageShown(); await flush(0);
    expect(world.probes).toBe(1);
  });
  it("a probe that finishes after stop() cannot change the state", async () => {
    let release: (v: boolean) => void = () => {};
    const world = { browserOnline: true };
    const c = createConnectivity({ probe: () => new Promise<boolean>((r) => { release = r; }), now: Date.now, browserOnline: () => world.browserOnline, pageVisible: () => true, setTimer: (f, m) => setTimeout(f, m), clearTimer: (i) => clearTimeout(i as ReturnType<typeof setTimeout>), random: () => 0.5 });
    c.start(); c.requestFailed(); await flush(0);
    c.stop(); release(false); await flush(10);
    expect(c.getSnapshot().status).toBe("online");
    expect(c.getSnapshot().failures).toBe(0);
  });
  it("a probe that throws is treated as a miss, never as a crash", async () => {
    const c = createConnectivity({ probe: async () => { throw new Error("boom"); }, now: Date.now, browserOnline: () => true, pageVisible: () => true, setTimer: (f, m) => setTimeout(f, m), clearTimer: (i) => clearTimeout(i as ReturnType<typeof setTimeout>), random: () => 0.5 });
    c.start(); c.requestFailed(); await flush(CONFIRM_MS + 10);
    expect(c.getSnapshot().status).toBe("offline");
  });
  it("notifies subscribers on change and stops after unsubscribe", async () => {
    const { c, world } = harness(); c.start();
    const fn = vi.fn(); const off = c.subscribe(fn);
    world.reachable = false; c.browserOffline(); await flush(0);
    expect(fn).toHaveBeenCalled();
    fn.mockClear(); off(); c.browserOnline(); await flush(0);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("retryDelay", () => {
  it("doubles from 2 s, caps at 30 s, and stays inside the ±20 % jitter band", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => retryDelay(n, () => 0.5))).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    for (let n = 1; n < 12; n++) for (const r of [0, 0.25, 0.999]) { const d = retryDelay(n, () => r); expect(d).toBeGreaterThanOrEqual(500); expect(d).toBeLessThanOrEqual(RETRY_MAX_MS); }
  });
  it("is safe for nonsense attempt numbers", () => { expect(retryDelay(0, () => 0.5)).toBe(2000); expect(retryDelay(-5, () => 0.5)).toBe(2000); });
});

describe("guardedFetch: fail fast and quietly while offline", () => {
  const origin = "https://trailmate.test";
  const mk = (status: "online" | "offline", base: typeof fetch) => {
    const requestFailed = vi.fn();
    return { requestFailed, f: guardedFetch(base, { getSnapshot: () => ({ status } as never), requestFailed }, origin) };
  };
  it("answers our own API calls with a friendly OfflineError at once while offline, without touching the network", async () => {
    const base = vi.fn(); const { f } = mk("offline", base as never);
    await expect(f("/api/places")).rejects.toBeInstanceOf(OfflineError);
    expect(base).not.toHaveBeenCalled();
  });
  it("the message is plain language, not a stack trace", async () => {
    const { f } = mk("offline", vi.fn() as never);
    const e = await f("/api/eta", { method: "POST" }).catch((x) => x);
    expect(isOfflineError(e)).toBe(true);
    expect(String(e.message)).toMatch(/offline/i);
  });
  it("lets the connectivity probe through even while offline (it is how we find out we are back)", async () => {
    const base = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); const { f } = mk("offline", base as never);
    await f("/api/ping?t=1"); expect(base).toHaveBeenCalledTimes(1);
  });
  it("never blocks other sites (map tiles, Supabase) or non-API pages", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok")); const { f } = mk("offline", base as never);
    await f("https://tiles.openfreemap.org/x.pbf"); await f("https://abc.supabase.co/rest/v1/x"); await f("/trips/123");
    expect(base).toHaveBeenCalledTimes(3);
  });
  it("online: passes through, and a network failure asks for a connectivity check and rethrows the original error", async () => {
    const err = new TypeError("Failed to fetch");
    const { f, requestFailed } = mk("online", vi.fn().mockRejectedValue(err) as never);
    await expect(f("/api/places")).rejects.toBe(err);
    expect(requestFailed).toHaveBeenCalledTimes(1);
  });
  it("an aborted request says nothing about the network", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { f, requestFailed } = mk("online", vi.fn().mockRejectedValue(abort) as never);
    await expect(f("/api/places")).rejects.toBe(abort);
    expect(requestFailed).not.toHaveBeenCalled();
  });
  it("an HTTP error response is not a connectivity problem", async () => {
    const { f, requestFailed } = mk("online", vi.fn().mockResolvedValue(new Response("no", { status: 500 })) as never);
    const res = await f("/api/places"); expect(res.status).toBe(500);
    expect(requestFailed).not.toHaveBeenCalled();
  });
  it("isGuardedRequest understands strings, URLs and Requests, and survives garbage", () => {
    expect(isGuardedRequest("/api/x", origin)).toBe(true);
    expect(isGuardedRequest(new URL("/api/x", origin), origin)).toBe(true);
    expect(isGuardedRequest(new Request(`${origin}/api/x`), origin)).toBe(true);
    expect(isGuardedRequest("https://evil.test/api/x", origin)).toBe(false);
    expect(isGuardedRequest("/api/ping", origin)).toBe(false);
    expect(isGuardedRequest("http://[bad", origin)).toBe(false);
  });
});

describe("makeProbe", () => {
  it("true for ANY http answer (even 500: the network works, the server is the problem)", async () => {
    for (const status of [204, 404, 500, 503]) expect(await makeProbe((async () => new Response(null, { status })) as never)()).toBe(true);
  });
  it("false when the request cannot be made", async () => { expect(await makeProbe((async () => { throw new TypeError("Failed to fetch"); }) as never)()).toBe(false); });
  it("false when the request hangs past the timeout, and the request is aborted", async () => {
    let signal: AbortSignal | undefined;
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => { signal = init.signal as AbortSignal; signal.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))); })) as never;
    const p = makeProbe(hang, 4000)();
    await vi.advanceTimersByTimeAsync(4001);
    expect(await p).toBe(false);
    expect(signal?.aborted).toBe(true);
  });
  it("asks for an uncached, cookie-less request to the ping route", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await makeProbe(f as never)();
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/^\/api\/ping\?t=\d+$/);
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit", method: "GET" });
  });
});
