// Every answer the traveller gives must change the plan in the way it says. (Before: "Anything to avoid?" and "Where do you stay?" were
// asked, saved, and then ignored.)
import { describe, expect, it } from "vitest";
import { parseAvoid } from "@/lib/engine/avoid";
import { dayStartFor, styleFor } from "@/lib/engine/core";
import { pickTown } from "@/lib/engine/halts";
import { planTrip, transitCap } from "@/lib/engine/plan";
import { DEFAULT_PREFS, type Prefs } from "@/lib/engine/types";
import { makeInput, type Spec } from "./builder-fixtures";
import { engineInput, townFinder } from "./engine-fixtures";

const prefs = (o: Partial<Prefs>): Prefs => ({ ...DEFAULT_PREFS, ...o });
const SPECS: Spec[] = [{ name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }, { name: "Matheran", category: "hill_station" }, { name: "Alibaug", category: "beach" }];
const run = (p: Partial<Prefs>, numDays = 3) => planTrip(engineInput(makeInput(SPECS, { numDays, endMode: "start", startDateISO: "2026-12-12" }), { towns: townFinder([]), prefs: p }));

describe("reading what to avoid", () => {
  it("understands the screen's labels and the traveller's own words, and ignores junk", () => {
    expect(parseAvoid(["Long drives", "Very early starts", "Long walks or treks", "Driving at night"])).toEqual(["long_drives", "early_starts", "long_walks", "night_driving"]);
    expect(parseAvoid(["not too much driving", "no sunrise starts please", "I hate steep climbs"])).toEqual(["long_drives", "early_starts", "long_walks"]);
    expect(parseAvoid(["crowds"])).toEqual(["crowds"]);
    expect(parseAvoid([3, null, "pineapple"])).toEqual([]);
    expect(parseAvoid("long drives")).toEqual([]);
  });
});

describe("avoid long drives", () => {
  it("caps the daily driving of every plan at the gentle limit", () => {
    for (const v of ["relaxed", "balanced", "most"] as const) expect(styleFor(v, prefs({ avoid: ["long_drives"] }), null).override.maxDriveMin).toBeLessThanOrEqual(270);
    expect(styleFor("most", prefs({}), null).override.maxDriveMin).toBe(480);
    expect(transitCap("most", prefs({ avoid: ["long_drives"] }))).toBeLessThan(transitCap("most", prefs({})));
  });
  it("no ordinary day in the plan drives more than that", () => {
    for (const v of run({ avoid: ["long_drives"] }, 4).variants) for (const d of v.option.days) if (!d.longTransfer) expect(d.driveMin).toBeLessThanOrEqual(271);
  });
});

describe("avoid very early starts", () => {
  it("no day starts before 9:00, in any plan", () => {
    expect(dayStartFor("most", prefs({ avoid: ["early_starts"] }))).toBe(540);
    expect(dayStartFor("most", prefs({}))).toBe(480);
    expect(dayStartFor("relaxed", prefs({ avoid: ["early_starts"] }))).toBe(540); // already 9:00: unchanged
    for (const v of run({ avoid: ["early_starts"] }).variants) for (const d of v.option.days) if (d.stops.length) expect(d.startMin).toBeGreaterThanOrEqual(540);
  });
  it("a later start leaves less room in the day, never more", () => {
    const a = styleFor("most", prefs({}), null).override, b = styleFor("most", prefs({ avoid: ["early_starts"] }), null).override;
    expect(b.capacityMin!).toBeLessThanOrEqual(a.capacityMin!);
  });
});

describe("avoid long walks or treks", () => {
  it("treks and activities become the first to go", () => {
    const a = styleFor("balanced", prefs({ avoid: ["long_walks"] }), null).override.appeal!;
    expect(a.trek).toBeLessThanOrEqual(0.4); expect(a.activity).toBeLessThanOrEqual(0.7);
    expect(styleFor("balanced", prefs({}), null).override.appeal!.trek).toBeUndefined();
  });
  it("when a day is too full, the trek is left out before the temple", () => {
    const specs: Spec[] = [{ name: "Lonavala", category: "temple" }, { name: "Khandala", category: "temple" }, { name: "Rajmachi", category: "trek" }, { name: "Pawna Lake", category: "temple" }];
    const plan = planTrip(engineInput(makeInput(specs, { numDays: 1, endMode: "free", startDateISO: "2026-12-12" }), { towns: townFinder([]), prefs: { avoid: ["long_walks"] } }));
    const v = plan.variants.find((x) => x.id === "balanced")!;
    if (v.option.removed.length) expect(v.option.removed.map((r) => r.name)).toContain("Rajmachi");
    expect(v.option.removed.some((r) => r.name === "Lonavala" || r.name === "Khandala")).toBe(false);
  });
});

describe("the kind of stay picks the town for the night", () => {
  const towns = townFinder([
    { name: "Bigcity", area: "State", lat: 17.2, lng: 78.0, pop: 400_000 },   // ~25 km north of the stop
    { name: "Midtown", area: "State", lat: 17.05, lng: 78.0, pop: 30_000 },   // ~6 km
    { name: "Villageton", area: "State", lat: 17.02, lng: 78.0, pop: 3_000 }, // ~2 km
  ]);
  const at = { lat: 17.0, lng: 78.0 };
  it("hotel / resort / not said: a town of 20,000+ (as before)", () => {
    for (const s of [null, "hotel", "resort"] as const) { const t = pickTown(towns, at, undefined, undefined, s); expect(t?.name).toBe("Midtown"); expect(t?.checkStays).toBe(false); }
  });
  it("homestay and camping: the nearest village, marked check stays", () => {
    for (const s of ["homestay", "camping"] as const) { const t = pickTown(towns, at, undefined, undefined, s); expect(t?.name).toBe("Villageton"); expect(t?.checkStays).toBe(true); }
  });
  it("hostel: the city, even though it is further", () => {
    const t = pickTown(towns, at, undefined, undefined, "hostel");
    expect(t?.name).toBe("Bigcity"); expect(t?.checkStays).toBe(false);
  });
  it("with no suitable town the old rule still finds one", () => {
    const only = townFinder([{ name: "Midtown", area: "State", lat: 17.05, lng: 78.0, pop: 30_000 }]);
    expect(pickTown(only, at, undefined, undefined, "hostel")?.name).toBe("Midtown");
  });
  it("the plan's night halts follow the stay", () => {
    const names = ["Rajmachi", "Matheran", "Alibaug"] as const;
    const specs: Spec[] = names.map((n) => ({ name: n }));
    const base = makeInput(specs, { numDays: 3, endMode: "free", startDateISO: "2026-12-12" });
    // next to every stop: a village 2 km away and a city 30 km away
    const around = base.places.flatMap((p) => [
      { name: `Village-${p.name}`, area: "x", lat: p.lat + 0.02, lng: p.lng, pop: 2_000 },
      { name: `City-${p.name}`, area: "x", lat: p.lat + 0.27, lng: p.lng, pop: 300_000 },
    ]);
    const halts = (stay: Prefs["stay"]) => planTrip(engineInput(base, { towns: townFinder(around), prefs: { stay } })).variants[1].halts.map((h) => h.town);
    expect(halts("homestay").length).toBeGreaterThan(0);
    for (const t of halts("homestay")) expect(t).toMatch(/^Village-/);
    for (const t of halts("hostel")) expect(t).toMatch(/^City-/);
  });
});

describe("travelling by bus or train is said plainly", () => {
  it("the plan says it uses car road times and that timetables are not known", () => {
    for (const mode of ["bus", "train"] as const) expect(run({ mode }).labels.travel).toMatch(new RegExp(`${mode}.*car.*timetables`, "i"));
    expect(run({ mode: "car" }).labels.travel).toBe("");
    expect(run({ mode: "bike" }).labels.travel).toBe("");
  });
});
