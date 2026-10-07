import { describe, expect, it } from "vitest";
import { buildAlerts } from "@/lib/alerts";
import type { Conditions } from "@/lib/weather";

const cond = (o: Partial<Conditions>): Conditions => ({ kind: "forecast", tempMaxC: 30, precipMmPerDay: 0, rainyDayShare: 0, sampleDays: 1, ...o });

describe("buildAlerts", () => {
  it("warns about heavy rain for rain-sensitive places, info for moderate rain", () => {
    const a = buildAlerts([
      { id: "1", name: "Fort A", category: "fort", conditions: cond({ precipMmPerDay: 20 }) },
      { id: "2", name: "Trek B", category: "trek", conditions: cond({ precipMmPerDay: 8 }) },
    ]);
    expect(a.map((x) => [x.placeId, x.severity])).toEqual([["1", "warn"], ["2", "info"]]);
    expect(a[1].text).toMatch(/slippery/);
  });

  it("never alerts from typical climate, only from a real forecast", () => {
    expect(buildAlerts([{ id: "1", name: "Fort", category: "fort", conditions: cond({ kind: "typical", precipMmPerDay: 30, tempMaxC: 44 }) }])).toEqual([]);
  });

  it("flags extreme heat for outdoor places but not for museums", () => {
    const a = buildAlerts([
      { id: "1", name: "Beach", category: "beach", conditions: cond({ tempMaxC: 40 }) },
      { id: "2", name: "Museum", category: "museum", conditions: cond({ tempMaxC: 40 }) },
    ]);
    expect(a.map((x) => x.placeId)).toEqual(["1"]);
  });

  it("tells waterfall visitors when no rain means a weak flow, and ignores missing weather", () => {
    const a = buildAlerts([
      { id: "1", name: "Falls", category: "waterfall", conditions: cond({ precipMmPerDay: 0 }) },
      { id: "2", name: "Nowhere", category: "fort", conditions: null },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/flow may be weak/);
  });

  it("puts warnings first and caps the list", () => {
    const stops = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `S${i}`, category: "fort" as const, conditions: cond({ precipMmPerDay: i % 2 ? 20 : 8 }) }));
    const a = buildAlerts(stops);
    expect(a).toHaveLength(5);
    expect(a.map((x) => x.severity)).toEqual(["warn", "warn", "warn", "warn", "info"]);
  });
});
