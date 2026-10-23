// D6 (Phase 4): a name shared by far-apart places is not "Sure" just because one is nearer the start. Real case from the Phase 3 sample
// trips: from Hyderabad, "Manali" matched the Manali in Chennai (520 km) instead of the Manali in Himachal Pradesh (1,650 km).
import { describe, expect, it, vi } from "vitest";
import { buildIndex, type GeoIndexData } from "@/lib/places/geo-index";
import { resolvePlaces, START_ONLY_CLEAR_KM } from "@/lib/intake/places";
import type { SaidPlace } from "@/lib/intake/types";

const DATA: GeoIndexData = {
  version: 1, source: "test", built: "x", states: ["Tamil Nadu", "Himachal Pradesh", "Telangana"], districts: ["Chennai", "Kulu", "Hyderabad", "Medak"],
  rows: [
    ["Manali", 13.167, 80.267, "town", 0, 0, 37000], // GeoNames: Manali, Chennai
    ["Manali", 32.243, 77.189, "town", 1, 1, 8096], // GeoNames: Manali, Kulu
    ["Hyderabad", 17.385, 78.4867, "city", 2, 2, 6993262],
    ["Narsapur", 17.74, 78.29, "town", 2, 3, 20000],
    ["Narsapur", 16.43, 81.7, "town", 2, 3, 58000],
  ],
};
const ix = buildIndex(DATA);
const said = (s: string): SaidPlace => ({ said: s, must: false, source: "said", evidence: s });
const deps = () => ({ index: async () => ix, photon: vi.fn(async () => []), allow: vi.fn(async () => true) });
const HYD = { lat: 17.385, lng: 78.4867, name: "Hyderabad" };

describe("same name, far apart: ask, don't guess", () => {
  it("'Manali' from Hyderabad needs a check and offers both", async () => {
    const [m] = await resolvePlaces([said("Manali")], { start: HYD }, deps());
    expect(m.status).toBe("check");
    expect(m.reason).toMatch(/2 places are called “Manali”/);
    expect([m.place!, ...m.alternatives].map((o) => o.area)).toEqual(expect.arrayContaining([expect.stringContaining("Himachal Pradesh"), expect.stringContaining("Tamil Nadu")]));
  });
  it("a clearly nearer one within a day's drive of the start is still chosen for you", async () => {
    const [m] = await resolvePlaces([said("Narsapur")], { start: HYD }, deps()); // 45 km vs 400 km
    expect(m.status).toBe("sure");
    expect(m.place!.lat).toBeCloseTo(17.74, 2);
    expect(START_ONLY_CLEAR_KM).toBe(250);
  });
});
