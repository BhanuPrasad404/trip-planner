import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStored, useLocalJson } from "@/lib/client/use-local-json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type S = { a: number; b: string };
const FALLBACK: S = { a: 1, b: "x" };

let store: Record<string, string>; let blocked: boolean; let storageListeners: (() => void)[];
beforeEach(() => {
  store = {}; blocked = false; storageListeners = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => { if (blocked) throw new Error("blocked"); return store[k] ?? null; },
      setItem: (k: string, v: string) => { if (blocked) throw new Error("blocked"); store[k] = v; },
    },
    addEventListener: (_: string, f: () => void) => { storageListeners.push(f); },
    removeEventListener: (_: string, f: () => void) => { storageListeners = storageListeners.filter((x) => x !== f); },
  });
});
afterEach(() => vi.unstubAllGlobals());

let api!: ReturnType<typeof useLocalJson<S>>;
function Harness({ k }: { k: string }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  api = useLocalJson(k, FALLBACK);
  return null;
}
let r: TestRenderer.ReactTestRenderer;
const mount = (k: string) => { act(() => { r = TestRenderer.create(createElement(Harness, { k })); }); };
afterEach(() => { act(() => r?.unmount()); });

describe("parseStored never throws and never loses the defaults", () => {
  it("nothing stored, damaged JSON, wrong shapes: all give the fallback", () => {
    for (const raw of [null, "{oops", "null", "[1,2]", '"text"', "42"]) expect(parseStored(raw, FALLBACK), String(raw)).toBe(FALLBACK);
  });
  it("stored fields override the defaults; missing fields keep them (so old saved data still works after an update)", () => {
    expect(parseStored('{"a":5}', FALLBACK)).toEqual({ a: 5, b: "x" });
  });
});

describe("useLocalJson", () => {
  it("starts from the fallback, saves changes to the browser, and updates the screen", () => {
    mount("k1");
    expect(api[0]).toEqual(FALLBACK);
    act(() => api[1]({ a: 2, b: "y" }));
    expect(api[0]).toEqual({ a: 2, b: "y" });
    expect(JSON.parse(store.k1)).toEqual({ a: 2, b: "y" });
  });
  it("an update can be written as a function of the current value", () => {
    mount("k2");
    act(() => api[1]((c) => ({ ...c, a: c.a + 1 })));
    act(() => api[1]((c) => ({ ...c, a: c.a + 1 })));
    expect(api[0].a).toBe(3);
  });
  it("picks up what was saved before (a reload)", () => {
    store.k3 = JSON.stringify({ a: 9, b: "z" });
    mount("k3");
    expect(api[0]).toEqual({ a: 9, b: "z" });
  });
  it("keys are separate (one value per trip)", () => {
    mount("trip-A");
    act(() => api[1]({ a: 7, b: "A" }));
    act(() => r.unmount());
    mount("trip-B");
    expect(api[0]).toEqual(FALLBACK);
  });
  it("when the browser blocks storage the page still works for this visit", () => {
    blocked = true;
    mount("k5");
    expect(api[0]).toEqual(FALLBACK);
    act(() => api[1]({ a: 4, b: "mem" }));
    expect(api[0]).toEqual({ a: 4, b: "mem" });
  });
  it("another tab changing the value updates this one", () => {
    mount("k6");
    store.k6 = JSON.stringify({ a: 8, b: "tab" });
    act(() => storageListeners.forEach((f) => f()));
    expect(api[0]).toEqual({ a: 8, b: "tab" });
  });
});
