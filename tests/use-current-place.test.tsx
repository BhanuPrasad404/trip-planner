import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A fake phone: GPS answers when the test says so, the permission is whatever the test sets, and the network is on or off.
let online = true;
vi.mock("@/lib/client/use-connectivity", () => ({ useOnline: () => online }));

import { HERE_NAME_KEY, useCurrentPlace, type CurrentPlace } from "@/lib/client/use-current-place";

type PosCb = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type ErrCb = (e: { code: number }) => void;
let pending: { ok: PosCb; fail: ErrCb } | null;
let permission: "granted" | "denied" | "prompt" | "throws";
let permListeners: (() => void)[];
let permStatus: { state: string; addEventListener: (t: string, f: () => void) => void; removeEventListener: () => void };
const geo = { getCurrentPosition: vi.fn((ok: PosCb, fail: ErrCb) => { pending = { ok, fail }; }) };
let store: Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

function stubPhone(opts: { geolocation?: boolean; secure?: boolean } = {}) {
  permStatus = { state: permission, addEventListener: (_t, f) => permListeners.push(f), removeEventListener: () => {} };
  vi.stubGlobal("navigator", {
    ...(opts.geolocation === false ? {} : { geolocation: geo }),
    permissions: { query: vi.fn(async () => { if (permission === "throws") throw new Error("not supported"); permStatus.state = permission; return permStatus; }) },
  });
  vi.stubGlobal("window", { isSecureContext: opts.secure ?? true, localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
}

let out: { place: CurrentPlace; locate: () => void };
function Harness({ auto, now }: { auto: boolean; now: () => number }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  out = useCurrentPlace({ auto, now });
  return null;
}
let renderer: TestRenderer.ReactTestRenderer;
const clock = 1_800_000_000_000;
const mount = async (auto = false) => { await act(async () => { renderer = TestRenderer.create(createElement(Harness, { auto, now: () => clock })); }); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const gpsFix = async (lat: number, lng: number, accuracy = 30) => { await act(async () => { pending!.ok({ coords: { latitude: lat, longitude: lng, accuracy } }); await vi.advanceTimersByTimeAsync(0); }); };
const gpsError = async (code: number) => { await act(async () => { pending!.fail({ code }); }); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  online = true;
  pending = null;
  permission = "prompt";
  permListeners = [];
  store = {};
  geo.getCurrentPosition.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ found: true, name: "Madhapur, Hyderabad", area: "Rangareddi, Telangana", approximate: false }), { status: 200 }));
  stubPhone();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("start location — permission states", () => {
  it("not asked yet: nothing happens by itself (no prompt), a tap is needed", async () => {
    await mount(true);
    expect(out.place).toEqual({ status: "idle", permission: "prompt" });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });
  it("already allowed + auto: fills in WITHOUT a tap", async () => {
    permission = "granted"; stubPhone();
    await mount(true);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    await gpsFix(17.4483, 78.3915);
    expect(out.place).toMatchObject({ status: "found", name: "Madhapur, Hyderabad", area: "Rangareddi, Telangana", accuracyM: 30, naming: false });
  });
  it("already allowed but auto is off (e.g. adding a stop): still waits for a tap", async () => {
    permission = "granted"; stubPhone();
    await mount(false);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });
  it("blocked: says so straight away, without asking the phone", async () => {
    permission = "denied"; stubPhone();
    await mount(true);
    expect(out.place).toEqual({ status: "problem", problem: "denied" });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });
  it("the traveller allows it in settings while the screen is open: the 'blocked' message goes away", async () => {
    permission = "denied"; stubPhone();
    await mount(true);
    permission = "prompt"; permStatus.state = "prompt";
    await act(async () => { for (const f of permListeners) f(); });
    expect(out.place.status).toBe("idle");
  });
  it("a browser that can't report the permission: shows the tap button (never auto-prompts)", async () => {
    permission = "throws"; stubPhone();
    await mount(true);
    expect(out.place).toEqual({ status: "idle", permission: "unknown" });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe("start location — after a tap", () => {
  it("finding → slow after 6 s → found and named", async () => {
    await mount();
    act(() => out.locate());
    expect(out.place).toEqual({ status: "locating", slow: false });
    await advance(6_000);
    expect(out.place).toEqual({ status: "locating", slow: true });
    await gpsFix(17.4483, 78.3915);
    expect(out.place).toMatchObject({ status: "found", name: "Madhapur, Hyderabad" });
    // only the rounded (~100 m) position leaves the phone
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ lat: 17.448, lng: 78.392 });
  });
  it("tap refused by the traveller → 'blocked' with how to allow it", async () => {
    await mount(); act(() => out.locate()); await gpsError(1);
    expect(out.place).toEqual({ status: "problem", problem: "denied" });
  });
  it("GPS off / no signal → 'unavailable'", async () => {
    await mount(); act(() => out.locate()); await gpsError(2);
    expect(out.place).toEqual({ status: "problem", problem: "unavailable" });
  });
  it("browser timeout → 'timeout'", async () => {
    await mount(); act(() => out.locate()); await gpsError(3);
    expect(out.place).toEqual({ status: "problem", problem: "timeout" });
  });
  it("a phone that never answers at all → our own deadline gives up after ~21 s", async () => {
    await mount(); act(() => out.locate());
    await advance(21_000);
    expect(out.place).toEqual({ status: "problem", problem: "timeout" });
    await gpsFix(17.4, 78.4); // a late answer is ignored
    expect(out.place.status).toBe("problem");
  });
  it("no location support, or an insecure page → said plainly, nothing asked", async () => {
    stubPhone({ geolocation: false });
    await mount(); act(() => out.locate());
    expect(out.place).toEqual({ status: "problem", problem: "unsupported" });
    stubPhone({ secure: false });
    act(() => out.locate());
    expect(out.place).toEqual({ status: "problem", problem: "insecure" });
  });
  it("a rough network position is kept with its real accuracy (the screen says how rough)", async () => {
    await mount(); act(() => out.locate()); await gpsFix(17.4483, 78.3915, 4500);
    expect(out.place).toMatchObject({ status: "found", accuracyM: 4500 });
  });
});

describe("start location — the daily limit is not wasted", () => {
  it("the name is remembered on the phone; within 1 km it is reused with NO server call", async () => {
    await mount(); act(() => out.locate()); await gpsFix(17.4483, 78.3915);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store[HERE_NAME_KEY])).toMatchObject({ lat: 17.448, lng: 78.392, name: "Madhapur, Hyderabad" });
    act(() => out.locate()); await gpsFix(17.452, 78.395); // ~0.5 km away
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.place).toMatchObject({ status: "found", name: "Madhapur, Hyderabad" });
  });
  it("moved more than 1 km → looked up again", async () => {
    await mount(); act(() => out.locate()); await gpsFix(17.4483, 78.3915);
    act(() => out.locate()); await gpsFix(17.4849, 78.4138); // Kukatpally, ~4.6 km
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("offline: the position still works; the name is fetched ONCE when the network comes back (no retry loop)", async () => {
    online = false;
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await mount(); act(() => out.locate()); await gpsFix(17.4483, 78.3915);
    expect(out.place).toMatchObject({ status: "found", name: null, nameFailed: true });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ found: true, name: "Madhapur, Hyderabad", area: "x" }), { status: 200 }));
    online = true;
    await act(async () => { renderer.update(createElement(Harness, { auto: false, now: () => clock })); });
    await advance(0);
    expect(out.place).toMatchObject({ status: "found", name: "Madhapur, Hyderabad" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("server keeps failing while online: it does NOT keep retrying by itself", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await mount(); act(() => out.locate()); await gpsFix(17.4483, 78.3915);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.place).toMatchObject({ status: "found", name: null, nameFailed: true });
  });
});
