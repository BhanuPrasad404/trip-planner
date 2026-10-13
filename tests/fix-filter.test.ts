import { describe, expect, it } from "vitest";
import { filterFix, initialFilter, type FilterState, type RawFix } from "@/lib/location/fix-filter";

const T0 = 1_800_000_000_000;
const fix = (o: Partial<RawFix> & { dLat?: number } = {}): RawFix => ({ lat: 17.385 + (o.dLat ?? 0), lng: 78.4867, accuracyM: 8, at: T0, fixAt: T0, ...o });
const run = (readings: RawFix[], start: FilterState = initialFilter()) => {
  let state = start; const out: { accepted: boolean; reason: string }[] = [];
  for (const r of readings) { const v = filterFix(state, r); state = v.state; out.push({ accepted: v.accept, reason: v.reason }); }
  return { out, state };
};

describe("fix filter — what may move the marker", () => {
  it("the first valid reading is accepted", () => {
    expect(run([fix()]).out[0]).toEqual({ accepted: true, reason: "ok" });
  });
  it("invalid coordinates never get through", () => {
    for (const bad of [{ lat: NaN }, { lng: Infinity }, { lat: 91 }, { lng: -181 }]) expect(run([fix(), fix({ ...bad, at: T0 + 1000, fixAt: T0 + 1000 })]).out[1]).toEqual({ accepted: false, reason: "invalid" });
  });
  it("normal driving updates are all accepted (1 reading a second, 60 km/h)", () => {
    const rs = Array.from({ length: 20 }, (_, i) => fix({ dLat: (i * 16.7) / 111_320, at: T0 + i * 1000, fixAt: T0 + i * 1000 }));
    expect(run(rs).out.every((o) => o.accepted)).toBe(true);
  });
  it("a reading measured BEFORE the one already in use (out of order) is ignored", () => {
    const { out } = run([fix({ at: T0 + 5000, fixAt: T0 + 5000 }), fix({ at: T0 + 5100, fixAt: T0 + 2000, dLat: 0.0005 })]);
    expect(out[1]).toEqual({ accepted: false, reason: "out-of-order" });
  });
  it("a coarse network fix a km away, right after a precise GPS fix, does NOT move the marker (the reported jump)", () => {
    const { out } = run([fix(), fix({ dLat: 0.012, accuracyM: 1500, at: T0 + 1000, fixAt: T0 + 1000 })]);
    expect(out[1]).toEqual({ accepted: false, reason: "weaker-than-before" });
  });
  it("…and an unknown accuracy counts as weaker too", () => {
    expect(run([fix(), fix({ accuracyM: null, at: T0 + 1000, fixAt: T0 + 1000, dLat: 0.01 })]).out[1].accepted).toBe(false);
  });
  it("but if the weak position PERSISTS (GPS really lost: tunnel, indoors) it is accepted, so we never freeze on an old spot", () => {
    const weak = (s: number) => fix({ dLat: 0.012, accuracyM: 1500, at: T0 + s * 1000, fixAt: T0 + s * 1000 });
    const { out } = run([fix(), weak(1), weak(3), weak(5), weak(8)]);
    expect(out.map((o) => o.accepted)).toEqual([true, false, false, false, true]);
  });
  it("one weak reading between good ones does not poison the streak", () => {
    const g = (s: number) => fix({ at: T0 + s * 1000, fixAt: T0 + s * 1000 });
    const w = (s: number) => fix({ accuracyM: 900, dLat: 0.01, at: T0 + s * 1000, fixAt: T0 + s * 1000 });
    const { out } = run([g(0), w(1), g(2), w(3), g(4), w(5)]);
    expect(out.map((o) => o.accepted)).toEqual([true, false, true, false, true, false]);
  });
  it("after the precise fix is old (20 s), a rougher reading is simply what we have", () => {
    expect(run([fix(), fix({ accuracyM: 900, dLat: 0.01, at: T0 + 25_000, fixAt: T0 + 25_000 })]).out[1].accepted).toBe(true);
  });
  it("when we never had a precise fix (laptop: Wi-Fi/IP), readings are accepted — nothing to protect", () => {
    expect(run([fix({ accuracyM: 3000 }), fix({ accuracyM: 5000, dLat: 0.002, at: T0 + 1000, fixAt: T0 + 1000 })]).out[1].accepted).toBe(true);
  });
  it("an impossible jump (50 km in a second at similar accuracy) is ignored once; if the new place persists it is accepted", () => {
    const far = (s: number) => fix({ dLat: 0.45, at: T0 + s * 1000, fixAt: T0 + s * 1000 });
    const { out } = run([fix(), far(1), far(2)]);
    expect(out.map((o) => o.accepted)).toEqual([true, false, true]);
  });
  it("a plausible fast move is not a jump (a 300 m hop in 10 s = 108 km/h)", () => {
    expect(run([fix(), fix({ dLat: 300 / 111_320, at: T0 + 10_000, fixAt: T0 + 10_000 })]).out[1].accepted).toBe(true);
  });
});
