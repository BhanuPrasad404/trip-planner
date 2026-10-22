import { createElement, act, type ReactElement } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let online = true;
vi.mock("@/lib/client/use-connectivity", () => ({ useOnline: () => online }));
// The map preview is MapLibre (WebGL): replaced by a marker element so the test can see that it is shown and for which place.
vi.mock("next/dynamic", () => ({ default: () => (p: { label: string; accuracyM: number | null }) => createElement("div", { "data-preview": p.label, "data-accuracy": String(p.accuracyM) }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { PlaceSearch, clearPickerMemory, type PickedPlace } from "@/components/PlaceSearch";
import { NewTripForm } from "@/components/NewTripForm";
import { clearPlaceSearchMemory } from "@/lib/client/use-place-search";

type PosCb = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
let permission: "granted" | "prompt" | "denied";
let gpsAnswer: { lat: number; lng: number; acc: number } | { code: number } | null;
let store: Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let searchStatus: string;

function stubPhone() {
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition: (ok: PosCb, fail: (e: { code: number }) => void) => { const a = gpsAnswer; if (!a) return; if ("code" in a) fail(a); else ok({ coords: { latitude: a.lat, longitude: a.lng, accuracy: a.acc } }); } },
    permissions: { query: async () => ({ state: permission, addEventListener: () => {}, removeEventListener: () => {} }) },
  });
  vi.stubGlobal("window", { isSecureContext: true, localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: () => {} } });
  vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
beforeEach(() => {
  vi.useFakeTimers();
  online = true; permission = "prompt"; gpsAnswer = null; searchStatus = "ok";
  store = { "tm:recent-places:start:v1": JSON.stringify([{ name: "Vijayawada", area: "NTR, Andhra Pradesh", lat: 16.5, lng: 80.64, kind: "city", at: 1 }]) };
  clearPickerMemory(); clearPlaceSearchMemory(); push.mockClear();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/place-suggest") return json({ groups: [{ id: "towns", title: "Big cities of India", places: [{ id: "gn:1", name: "Hyderabad", lat: 17.38, lng: 78.48, kind: "city", area: "Telangana", state: "Telangana", source: "geonames" }] }] });
    if (url === "/api/saved-places") return json({ error: "Please sign in" }, 401);
    if (url === "/api/place-here") return json({ found: true, name: "Madhapur, Hyderabad", area: "Rangareddi, Telangana" });
    if (url === "/api/place-search") {
      const { q } = JSON.parse(String(init!.body)) as { q: string };
      return json({ status: searchStatus, sources: ["geonames"], results: [
        { id: "gn:2", name: "Kondapalli", lat: 16.62, lng: 80.54, kind: "town", area: "NTR, Andhra Pradesh", state: "Andhra Pradesh", source: "geonames" },
        { id: "gn:3", name: "Kondapalli", lat: 17.05, lng: 79.2, kind: "town", area: "Nalgonda, Telangana", state: "Telangana", source: "geonames" },
      ].filter(() => q.length >= 2) });
    }
    if (url === "/api/trips") return json({ id: "trip-9" }, 201);
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  stubPhone();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const textOf = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(" ")).replace(/\s+/g, " ").replace(/ ([.,·]) /g, "$1 ").replace(/· {2,}/g, "· ");
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
async function render(el: ReactElement) { let r!: TestRenderer.ReactTestRenderer; await act(async () => { r = TestRenderer.create(el); }); await flush(); return r; }
const input = (r: TestRenderer.ReactTestRenderer) => r.root.find((n) => n.type === "input" && n.props.role === "combobox");
const options = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "li" && n.props.role === "option");

function Field(props: Partial<Parameters<typeof PlaceSearch>[0]> & { onPick?: (p: PickedPlace | null) => void }) {
  return createElement(PlaceSearch, { label: "Starting from", value: null, onChange: props.onPick ?? (() => {}), recentList: "start", ...props });
}

describe("place picker — before typing", () => {
  it("tapping the box shows 'Use my current location' FIRST, then recent places and real suggestions, with the data credits", async () => {
    const r = await render(createElement(Field, { currentLocation: "offer" }));
    await act(async () => { input(r).props.onFocus(); });
    await flush();
    const opts = options(r).map(textOf);
    expect(opts[0]).toContain("Use my current location");
    expect(opts[1]).toContain("Recent");
    expect(opts[1]).toContain("Vijayawada");
    expect(opts.join("|")).toContain("Big cities of India");
    const all = textOf(r.root);
    expect(all).toContain("Place names: GeoNames (CC BY 4.0)");
    expect(all).toContain("© OpenStreetMap contributors");
  });
  it("where location isn't offered, there is no location row", async () => {
    const r = await render(createElement(Field, { currentLocation: "off" }));
    await act(async () => { input(r).props.onFocus(); });
    await flush();
    expect(options(r).map(textOf).join("|")).not.toContain("Use my current location");
  });
});

describe("place picker — typing", () => {
  it("results appear after a pause, with district and state so same-name places are told apart; choosing one fills the field", async () => {
    const picked: (PickedPlace | null)[] = [];
    const r = await render(createElement(Field, { onPick: (p) => picked.push(p) }));
    await act(async () => { input(r).props.onFocus(); input(r).props.onChange({ target: { value: "kondapalli" } }); });
    await flush(1000);
    const opts = options(r);
    expect(opts.map(textOf).join("|")).toMatch(/Kondapalli.*NTR, Andhra Pradesh.*\|.*Kondapalli.*Nalgonda, Telangana/);
    await act(async () => { opts[1].props.onClick(); });
    expect(picked[0]).toEqual({ name: "Kondapalli", address: "Nalgonda, Telangana", lat: 17.05, lng: 79.2, origin: "search" });
    expect(JSON.parse(store["tm:recent-places:start:v1"])[0].name).toBe("Kondapalli"); // remembered as recent
  });
  it("pressing Enter in the box never submits the form", async () => {
    const r = await render(createElement(Field, {}));
    const e = { key: "Enter", preventDefault: vi.fn() };
    await act(async () => { input(r).props.onKeyDown(e); });
    expect(e.preventDefault).toHaveBeenCalled();
  });
  it("limit reached: says so plainly, and still shows our own results", async () => {
    searchStatus = "limit";
    const r = await render(createElement(Field, {}));
    await act(async () => { input(r).props.onFocus(); input(r).props.onChange({ target: { value: "kondapalli" } }); });
    await flush(1000);
    expect(textOf(r.root)).toContain("Today’s map-search limit is used up".replace("’", "'"));
    expect(options(r)).toHaveLength(2);
  });
  it("offline: says searching needs the internet", async () => {
    online = false;
    const r = await render(createElement(Field, {}));
    await act(async () => { input(r).props.onFocus(); input(r).props.onChange({ target: { value: "kondapalli" } }); });
    await flush(1000);
    expect(textOf(r.root)).toContain("You're offline");
  });
});

describe("place picker — current location", () => {
  it("already allowed + 'auto': the start fills itself with a readable name, without a tap", async () => {
    permission = "granted"; gpsAnswer = { lat: 17.4483, lng: 78.3915, acc: 35 }; stubPhone();
    const picked: (PickedPlace | null)[] = [];
    await render(createElement(Field, { currentLocation: "auto", onPick: (p) => picked.push(p) }));
    await flush(10);
    expect(picked[0]).toEqual({ name: "Madhapur, Hyderabad", address: "Rangareddi, Telangana", lat: 17.448, lng: 78.392, origin: "gps", accuracyM: 35 });
  });
  it("not allowed yet: nothing is filled until the traveller taps", async () => {
    gpsAnswer = { lat: 17.4483, lng: 78.3915, acc: 35 };
    const picked: (PickedPlace | null)[] = [];
    const r = await render(createElement(Field, { currentLocation: "auto", onPick: (p) => picked.push(p) }));
    await flush(10);
    expect(picked).toEqual([]);
    await act(async () => { input(r).props.onFocus(); });
    await act(async () => { options(r)[0].props.onClick(); });
    await flush(10);
    expect(picked[0]).toMatchObject({ name: "Madhapur, Hyderabad", origin: "gps" });
  });
  it("blocked: tapping shows how to allow it", async () => {
    gpsAnswer = { code: 1 };
    const r = await render(createElement(Field, { currentLocation: "offer" }));
    await act(async () => { input(r).props.onFocus(); });
    await act(async () => { options(r)[0].props.onClick(); });
    await flush();
    const alert = r.root.find((n) => n.props.role === "alert");
    expect(textOf(alert)).toMatch(/blocked[\s\S]*Android[\s\S]*iPhone/);
  });
  it("a chosen current location shows how accurate it is, a small map, and a way to change it", async () => {
    const r = await render(createElement(Field, { value: { name: "Madhapur, Hyderabad", address: "Rangareddi, Telangana", lat: 17.448, lng: 78.392, origin: "gps", accuracyM: 35 } }));
    const t = textOf(r.root);
    expect(t).toMatch(/Your current location ?· ?Accurate to about 35 m/);
    expect(r.root.find((n) => n.props["data-preview"] === "Madhapur, Hyderabad").props["data-accuracy"]).toBe("35");
    expect(t).toContain("Change");
  });
  it("a rough network position is flagged, not shown as exact", async () => {
    const r = await render(createElement(Field, { value: { name: "Near Jangaon", address: "Jangoan, Telangana", lat: 17.6, lng: 79.2, origin: "gps", accuracyM: 6000 } }));
    expect(textOf(r.root)).toMatch(/Rough area only.*network position/);
  });
});

describe("new trip form — how the trip ends", () => {
  const radios = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "button" && n.props.role === "radio");
  it("offers Return to start / End at a place / Open-ended, and no place is forced as the destination", async () => {
    const r = await render(createElement(NewTripForm));
    expect(radios(r).map(textOf).map((t) => t.split("  ")[0].trim())).toEqual(expect.arrayContaining([expect.stringContaining("Return to start"), expect.stringContaining("End at a place"), expect.stringContaining("Open-ended")]));
    expect(radios(r)[0].props["aria-checked"]).toBe(true);
    expect(textOf(r.root)).not.toContain("Where does it end?");
    await act(async () => { radios(r)[1].props.onClick(); });
    expect(textOf(r.root)).toContain("Where does it end?");
  });
  it("'End at a place' without a place is caught before sending", async () => {
    const r = await render(createElement(NewTripForm));
    await act(async () => { r.root.find((n) => n.type === "input" && n.props.maxLength === 80 && n.props.role !== "combobox").props.onChange({ target: { value: "Goa" } }); });
    await act(async () => { radios(r)[1].props.onClick(); });
    await act(async () => { await r.root.find((n) => n.type === "form").props.onSubmit({ preventDefault: () => {} }); });
    expect(textOf(r.root)).toContain("Choose the place where the trip ends");
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/trips")).toBe(false);
  });
  it("'Return to start' is sent as the end choice, with no destination", async () => {
    const r = await render(createElement(NewTripForm));
    await act(async () => { r.root.find((n) => n.type === "input" && n.props.maxLength === 80 && n.props.role !== "combobox").props.onChange({ target: { value: "Weekend" } }); });
    await act(async () => { await r.root.find((n) => n.type === "form").props.onSubmit({ preventDefault: () => {} }); });
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/trips")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ name: "Weekend", end_mode: "start", dest_name: null, dest_lat: null });
    expect(push).toHaveBeenCalledWith("/trips/trip-9/plan");
  });
});
