// Task 5: the installable-app (PWA) manifest and icons, the service worker registered for everyone — and still nothing private cached.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import manifest from "@/app/manifest";
import { GET as iconGET, generateStaticParams } from "@/app/pwa-icon/[size]/route";
import AppleIcon, { size as appleSize } from "@/app/apple-icon";
import { config } from "@/proxy";
import { ServiceWorker } from "@/components/shell/ServiceWorker";
import { PWA_ICON_SIZES } from "@/lib/pwa";

const pngSize = async (res: Response) => {
  const b = new Uint8Array(await res.arrayBuffer());
  expect([...b.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer, b.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
};

describe("the web app manifest", () => {
  const m = manifest();
  it("has what phones need to install the app", () => {
    expect(m).toMatchObject({ name: "Trailmate", short_name: "Trailmate", start_url: "/dashboard", scope: "/", id: "/", display: "standalone", lang: "en-IN" });
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.description).toMatch(/India/);
  });
  it("lists 192 px and 512 px icons and a maskable one, each pointing at a real icon route", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(["192x192:any", "512x512:any", "512x512:maskable"]);
    const params = generateStaticParams().map((p) => `/pwa-icon/${p.size}`);
    for (const i of icons) expect(params).toContain(i.src);
  });
  it("contains nothing personal (it is the same public file for everyone)", () => {
    expect(JSON.stringify(m)).not.toMatch(/user|email|trip_id|token/i);
  });
});

describe("icon routes", () => {
  const get = (size: string) => iconGET(new Request(`https://x/pwa-icon/${size}`), { params: Promise.resolve({ size }) });
  it.each(Object.entries(PWA_ICON_SIZES))("%s → a real %i px PNG, publicly cacheable, no cookies", async (key, px) => {
    const res = await get(key);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/^public/);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await pngSize(res)).toEqual([px, px]);
  });
  it("an unknown size is a 404, not a crash", async () => {
    expect((await get("9999")).status).toBe(404);
  });
  it("the iPhone home-screen icon is a 180 px PNG", async () => {
    expect(await pngSize(AppleIcon() as unknown as Response)).toEqual([appleSize.width, appleSize.height]);
  });
});

describe("proxy (session refresh) skips the public app files", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  it("manifest and icons are never touched by a session", () => {
    for (const p of ["/manifest.webmanifest", "/pwa-icon/192", "/pwa-icon/maskable", "/apple-icon"]) expect(re.test(p), p).toBe(false);
  });
  it("signed-in pages still are", () => {
    for (const p of ["/dashboard", "/trips/abc/live", "/api/places"]) expect(re.test(p), p).toBe(true);
  });
});

describe("the root layout", () => {
  it("declares the iPhone home-screen settings (the manifest link itself is added by Next.js from app/manifest.ts)", () => {
    const src = readFileSync("app/layout.tsx", "utf8");
    expect(src).toMatch(/appleWebApp:\s*\{\s*capable:\s*true,\s*title:\s*"Trailmate"/);
  });
});

describe("ServiceWorker: registered for everyone, asks for nothing", () => {
  let registered: string[]; let asked: number; let loadListeners: (() => void)[]; let ready: string;
  let r: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    registered = []; asked = 0; loadListeners = []; ready = "complete";
    vi.stubGlobal("navigator", { serviceWorker: { register: async (u: string, o: { scope: string }) => { registered.push(`${u}|${o.scope}`); return {}; } } });
    vi.stubGlobal("document", { get readyState() { return ready; } });
    vi.stubGlobal("window", { addEventListener: (n: string, f: () => void) => { if (n === "load") loadListeners.push(f); }, removeEventListener() {} });
    vi.stubGlobal("Notification", { requestPermission: async () => { asked++; return "granted"; }, permission: "default" });
  });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it("registers /sw.js once the page has loaded, and never asks for notification permission", async () => {
    act(() => { r = TestRenderer.create(createElement(ServiceWorker)); });
    await flush();
    expect(registered).toEqual(["/sw.js|/"]);
    expect(asked).toBe(0);
  });
  it("waits for the page to finish loading first (does not slow the first paint)", async () => {
    ready = "loading";
    act(() => { r = TestRenderer.create(createElement(ServiceWorker)); });
    await flush();
    expect(registered).toEqual([]);
    act(() => loadListeners.forEach((f) => f()));
    await flush();
    expect(registered).toEqual(["/sw.js|/"]);
  });
  it("a browser without service workers is simply left alone", async () => {
    vi.stubGlobal("navigator", {});
    act(() => { r = TestRenderer.create(createElement(ServiceWorker)); });
    await flush();
    expect(registered).toEqual([]);
  });
});

describe("public/sw.js never stores a signed-in page or private data", () => {
  function run() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const stored: string[] = [];
    const cache = { add: vi.fn(async (r: Request | string) => { stored.push(typeof r === "string" ? r : new URL(r.url, "https://x").pathname); }), put: vi.fn(async (r: Request | string) => { stored.push(String(r)); }), addAll: vi.fn() };
    const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => []), delete: vi.fn(), match: vi.fn(async () => undefined) };
    const self = { addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; }, skipWaiting: vi.fn(), clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) } };
    const fetchMock = vi.fn(async () => new Response("<html>My trips: Araku weekend</html>"));
    vm.runInContext(readFileSync("public/sw.js", "utf8"), vm.createContext({ self, caches, fetch: fetchMock, Request: class { url: string; constructor(u: string) { this.url = u; } }, Response, console, Promise }));
    return { listeners, stored, cache };
  }
  it("installing stores ONLY the offline page; visiting signed-in pages stores nothing", async () => {
    const w = run();
    let done: Promise<unknown> = Promise.resolve();
    w.listeners.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    for (const url of ["/dashboard", "/trips/abc/live", "/profile"]) {
      let res: Promise<Response> | null = null;
      w.listeners.fetch({ request: { mode: "navigate", method: "GET", url }, respondWith: (p: Promise<Response>) => { res = p; } });
      await res;
    }
    expect(w.stored).toEqual(["/offline.html"]);
    expect(w.cache.put).not.toHaveBeenCalled();
    expect(w.cache.addAll).not.toHaveBeenCalled();
  });
});
