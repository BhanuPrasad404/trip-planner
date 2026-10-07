import { describe, expect, it } from "vitest";
import { contentKey, fitKey } from "@/lib/map/fit-key";

const places = [{ id: "a", lat: 17.1, lng: 80.1, day: 1, order: 1 }, { id: "b", lat: 17.7, lng: 83.2, day: 1, order: 2 }];
const base = { places, start: { lat: 17.385, lng: 78.486 }, destination: { lat: 17.687, lng: 83.218 }, activeDay: 1 };

describe("the map only re-frames when what it frames changes (not on every re-render)", () => {
  it("new object identities with the same values give the same key — so zooming out is never undone", () => {
    const again = { places: places.map((p) => ({ ...p })), start: { ...base.start }, destination: { ...base.destination }, activeDay: 1 };
    expect(contentKey(again)).toBe(contentKey(base));
    expect(fitKey({ ...again, fit: "day", frameStartDest: false })).toBe(fitKey({ ...base, fit: "day", frameStartDest: false }));
  });
  it("tiny floating-point noise does not count as a change", () => {
    expect(contentKey({ ...base, start: { lat: 17.385000001, lng: 78.486 } })).toBe(contentKey(base));
  });
  it("a different day, moved stop, new stop or different framing mode DOES change it", () => {
    const k = fitKey({ ...base, fit: "day", frameStartDest: false });
    expect(fitKey({ ...base, activeDay: 2, fit: "day", frameStartDest: false })).not.toBe(k);
    expect(fitKey({ ...base, places: [{ ...places[0], lat: 18 }, places[1]], fit: "day", frameStartDest: false })).not.toBe(k);
    expect(fitKey({ ...base, places: [...places, { id: "c", lat: 1, lng: 1, day: 2, order: 1 }], fit: "day", frameStartDest: false })).not.toBe(k);
    expect(fitKey({ ...base, fit: "all", frameStartDest: false })).not.toBe(k);
    expect(fitKey({ ...base, fit: "day", frameStartDest: true })).not.toBe(k);
  });
  it("handles missing start/destination", () => {
    expect(() => contentKey({ ...base, start: null, destination: null })).not.toThrow();
  });
});
