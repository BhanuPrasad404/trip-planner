import { describe, expect, it } from "vitest";
import { distanceKm, pathLengthKm } from "@/lib/geo";

const HYDERABAD = { lat: 17.385, lng: 78.4867 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

describe("distanceKm", () => {
  it("is ~620 km between Hyderabad and Mumbai (great-circle)", () => {
    const d = distanceKm(HYDERABAD, MUMBAI);
    expect(d).toBeGreaterThan(610);
    expect(d).toBeLessThan(630);
  });
  it("is zero for identical points and symmetric", () => {
    expect(distanceKm(MUMBAI, MUMBAI)).toBe(0);
    expect(distanceKm(HYDERABAD, MUMBAI)).toBeCloseTo(distanceKm(MUMBAI, HYDERABAD), 6);
  });
});

describe("pathLengthKm", () => {
  it("sums segments and is 0 for fewer than two points", () => {
    expect(pathLengthKm([])).toBe(0);
    expect(pathLengthKm([MUMBAI])).toBe(0);
    expect(pathLengthKm([HYDERABAD, MUMBAI, HYDERABAD])).toBeCloseTo(2 * distanceKm(HYDERABAD, MUMBAI), 6);
  });
});
