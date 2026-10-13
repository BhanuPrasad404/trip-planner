import { describe, expect, it } from "vitest";
import { MAX_DEVICE_ACCURACY_M, MAX_DEVICE_AGE_MS, chooseSearchCenter } from "@/lib/travel/search-center";

const HYD = { lat: 17.385, lng: 78.4867, label: "Hyderabad" };
const WARANGAL = { lat: 17.9689, lng: 79.5941 };
const BHONGIR = { lat: 17.5127, lng: 78.8887, label: "Bhongir Fort" };
const vizag = { lat: 17.6868, lng: 83.2185, label: "Visakhapatnam" };
const here = (o: Partial<{ accuracyM: number | null; ageMs: number }> = {}) => ({ ...WARANGAL, accuracyM: 25, ageMs: 10_000, ...o });

describe("planned start and actual location are never confused (acceptance)", () => {
  it("planned start Hyderabad, the traveller is in Warangal: hotels are searched around Warangal", () => {
    const c = chooseSearchCenter({ device: here(), permission: "granted", plannedStart: HYD, nextStop: BHONGIR, destination: vizag })!;
    expect(c).toMatchObject({ kind: "device", lat: WARANGAL.lat, lng: WARANGAL.lng, offerChoice: false });
    expect(c.label).toBe("where you are now"); expect(c.explanation).toBe("Searching around your current location.");
  });
  it("a place the traveller picked always wins, even over a good GPS position", () => {
    const c = chooseSearchCenter({ manual: { lat: 1, lng: 2, label: "Vijayawada" }, device: here(), plannedStart: HYD })!;
    expect(c.kind).toBe("manual"); expect(c.explanation).toContain("the place you chose");
  });
});

describe("fallbacks say what they did and why, and offer a choice", () => {
  it("location blocked: falls back to the next stop and says it is NOT where you are", () => {
    const c = chooseSearchCenter({ device: null, permission: "denied", nextStop: BHONGIR, plannedStart: HYD })!;
    expect(c).toMatchObject({ kind: "next_stop", label: "Bhongir Fort", offerChoice: true });
    expect(c.explanation).toContain("Location is blocked"); expect(c.explanation).toContain("not where you are"); expect(c.explanation).toContain("Choose a place");
  });
  it("order of fallbacks: next stop, then destination, then planned start", () => {
    expect(chooseSearchCenter({ device: null, nextStop: BHONGIR, destination: vizag, plannedStart: HYD })!.kind).toBe("next_stop");
    expect(chooseSearchCenter({ device: null, destination: vizag, plannedStart: HYD })!.kind).toBe("destination");
    const c = chooseSearchCenter({ device: null, plannedStart: HYD })!;
    expect(c.kind).toBe("planned_start"); expect(c.explanation).toContain("where the trip was planned to start");
  });
  it("an old position is not 'where you are'", () => {
    const c = chooseSearchCenter({ device: here({ ageMs: MAX_DEVICE_AGE_MS + 1 }), nextStop: BHONGIR })!;
    expect(c.kind).toBe("next_stop"); expect(c.explanation).toContain("out of date");
  });
  it("a very rough position is not 'where you are'", () => {
    const c = chooseSearchCenter({ device: here({ accuracyM: MAX_DEVICE_ACCURACY_M + 1 }), nextStop: BHONGIR })!;
    expect(c.explanation).toContain("too rough");
  });
  it("an unknown accuracy still counts when the position is recent", () => {
    expect(chooseSearchCenter({ device: here({ accuracyM: null }) })!.kind).toBe("device");
  });
  it("explains each reason for not having a position", () => {
    expect(chooseSearchCenter({ device: null, permission: "unavailable", nextStop: BHONGIR })!.explanation).toContain("isn't available");
    expect(chooseSearchCenter({ device: null, permission: "prompt", nextStop: BHONGIR })!.explanation).toContain("don't have your location");
  });
  it("nothing to search around at all: no result, not a made-up place", () => {
    expect(chooseSearchCenter({ device: null, permission: "denied" })).toBeNull();
  });
});
