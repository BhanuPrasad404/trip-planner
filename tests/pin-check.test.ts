import { describe, expect, it } from "vitest";
import { findFarPins } from "@/lib/pin-check";

const VIJAYAWADA = { lat: 16.5062, lng: 80.648, label: "Vijayawada" };
const kondapalli = { id: "a", lat: 16.6186, lng: 80.5336 }; // ~15 km from Vijayawada
const undavalli = { id: "b", lat: 16.4967, lng: 80.5806 };
const murbadKalu = { id: "c", lat: 18.7645, lng: 73.4155 }; // Maharashtra, ~800 km away

describe("findFarPins — the 'my Vijayawada trip shows Maharashtra' check", () => {
  it("flags a Maharashtra stop on a Vijayawada trip, and names the destination", () => {
    const r = findFarPins([kondapalli, undavalli, murbadKalu], VIJAYAWADA);
    expect(Object.keys(r)).toEqual(["c"]);
    expect(r.c.anchorLabel).toBe("Vijayawada");
    expect(r.c.km).toBeGreaterThan(700);
    expect(r.c.km).toBeLessThan(900);
  });

  it("flags nothing when everything is local, and works with a single stop", () => {
    expect(findFarPins([kondapalli, undavalli], VIJAYAWADA)).toEqual({});
    expect(findFarPins([murbadKalu], VIJAYAWADA).c).toBeDefined();
  });

  it("a day trip to Araku (~300 km) is NOT flagged — only truly distant pins are", () => {
    const araku = { id: "d", lat: 18.3273, lng: 82.8776 };
    expect(findFarPins([araku], VIJAYAWADA)).toEqual({});
  });

  it("with no destination, flags the outlier against the MEDIAN of the other stops", () => {
    const r = findFarPins([kondapalli, undavalli, { id: "e", lat: 16.55, lng: 80.6 }, murbadKalu], null);
    expect(Object.keys(r)).toEqual(["c"]);
    expect(r.c.anchorLabel).toBe("your other stops");
  });

  it("with no destination and fewer than 3 stops, it stays quiet (nothing reliable to compare)", () => {
    expect(findFarPins([kondapalli, murbadKalu], null)).toEqual({});
  });

  it("one far outlier doesn't make its neighbours look wrong (median, not average)", () => {
    const r = findFarPins([kondapalli, undavalli, { id: "e", lat: 16.55, lng: 80.6 }, { id: "f", lat: 16.52, lng: 80.62 }, murbadKalu], null);
    expect(Object.keys(r)).toEqual(["c"]);
  });
});
