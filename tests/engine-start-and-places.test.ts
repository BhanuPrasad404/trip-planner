// Two things a person knows without thinking, now the planner does too:
//   • "we start at 3:30 PM today": day 1 holds only the rest of that day (every other day is a normal day);
//   • "Nalgonda" is a town and "Visakhapatnam" a city, not a monument: a town is a short stop, a city is many sights.
import { describe, expect, it } from "vitest";
import { markSettlements, sameName, settlementOf, SETTLEMENT_VISIT_MIN } from "@/lib/engine/settlement";
import { planTrip } from "@/lib/engine/plan";
import { DEFAULT_PREFS } from "@/lib/engine/types";
import { lateStart } from "@/lib/server/trip-engine";
import { startMinOf } from "@/lib/server/builder";
import { STYLES } from "@/lib/trip-builder/config";
import { makeCtx } from "@/lib/trip-builder/model";
import { makeInput, type Spec } from "./builder-fixtures";
import { engineInput, townFinder } from "./engine-fixtures";

const SPECS: Spec[] = [{ name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }];

describe("a day 1 that starts late", () => {
  it("starts then and holds only the rest of that day; the other days are untouched", () => {
    const st = STYLES.balanced;
    const normal = makeCtx(makeInput(SPECS, { numDays: 3 }), st);
    const late = makeCtx({ ...makeInput(SPECS, { numDays: 3 }), firstDayStartMin: 15 * 60 }, st);
    expect(late.dayStart(1)).toBe(900); expect(late.dayStart(2)).toBe(st.dayStartMin);
    expect(late.dayCapacity(1)).toBe(st.dayEndMin - 900); // after 2 PM: no lunch to keep
    expect(late.dayCapacity(2)).toBe(st.capacityMin);
    expect(normal.dayCapacity(1)).toBe(st.capacityMin);
    // a start EARLIER than the style's never makes the day longer
    expect(makeCtx({ ...makeInput(SPECS, { numDays: 3 }), firstDayStartMin: 6 * 60 }, st).dayStart(1)).toBe(st.dayStartMin);
    // late morning: lunch is still in the day
    expect(makeCtx({ ...makeInput(SPECS, { numDays: 3 }), firstDayStartMin: 11 * 60 }, st).dayCapacity(1)).toBe(Math.min(st.capacityMin, st.dayEndMin - 660 - st.mealMin));
  });
  it("every plan's day 1 starts no earlier than the chosen time and holds no more than is left", () => {
    const base = { ...makeInput(SPECS, { numDays: 3, endMode: "start", startDateISO: "2026-12-12" }), firstDayStartMin: 13 * 60 };
    for (const v of planTrip(engineInput(base, { towns: townFinder([]) })).variants) {
      const d1 = v.option.days.find((d) => d.day === 1 && d.stops.length > 0);
      if (!d1) continue;
      expect(d1.startMin, v.label).toBeGreaterThanOrEqual(13 * 60);
      // (a single far stop may run over as a flagged "long transfer" day, the planner's existing rule)
      expect(d1.loadMin, v.label).toBeLessThanOrEqual(d1.longTransfer ? d1.capacityMin * 1.3 + 1 : d1.capacityMin + 1);
      expect(d1.capacityMin, v.label).toBeLessThan(STYLES.explorer.capacityMin);
    }
  });
  it("a late day 1 never keeps MORE places than a full day 1", () => {
    const mk = (first: number | null) => planTrip(engineInput({ ...makeInput(SPECS, { numDays: 1, endMode: "free", startDateISO: "2026-12-12" }), firstDayStartMin: first }, { towns: townFinder([]) }));
    const full = mk(null), late = mk(15 * 60);
    for (let i = 0; i < 3; i++) expect(late.variants[i].option.totals.places).toBeLessThanOrEqual(full.variants[i].option.totals.places);
  });
  it("too little of the day left: planned from the usual start, and the traveller is told why", () => {
    const base = { ...makeInput(SPECS, { numDays: 2, startDateISO: "2026-12-12" }), firstDayStartMin: 16 * 60 + 30 };
    const no = lateStart(base, DEFAULT_PREFS, "2026-12-12");
    expect(no.ignore).toBe(true); expect(no.note).toMatch(/less than 3 hours of daylight/); expect(no.note).toMatch(/allow driving after dark/);
    const yes = lateStart({ ...base, firstDayStartMin: 13 * 60 }, DEFAULT_PREFS, "2026-12-12");
    expect(yes.ignore).toBe(false); expect(yes.note).toMatch(/Day 1 starts at 1:00 PM/); expect(yes.note).toMatch(/sunset/);
    // with night driving allowed the day can run to its normal end (8 PM): 4:30 PM still leaves enough
    expect(lateStart(base, { ...DEFAULT_PREFS, nightDriving: true }, "2026-12-12").ignore).toBe(false);
    expect(lateStart({ ...base, firstDayStartMin: null }, DEFAULT_PREFS, "2026-12-12")).toEqual({ ignore: false, note: null });
  });
  it("reads the database's time column", () => {
    expect(startMinOf("15:30:00")).toBe(930); expect(startMinOf("09:05")).toBe(545);
    expect(startMinOf(null)).toBeNull(); expect(startMinOf("25:00")).toBeNull(); expect(startMinOf(930)).toBeNull();
  });
});

describe("towns and cities are not monuments", () => {
  const near = (name: string, pop: number, kind = "town", km = 1) => [{ name, kind, pop, km }];
  it("matches names the way people write them", () => {
    expect(sameName("Nalgonda", "Nalgonda")).toBe(true);
    expect(sameName("Nalgonda town", "Nalgonda")).toBe(true);
    expect(sameName("Vishakhapatnam", "Visakhapatnam")).toBe(true);
    expect(sameName("Charminar", "Hyderabad")).toBe(false);
    expect(sameName("Goa", "Gaya")).toBe(false); // short names must match exactly
  });
  it("a town is a short stop; a big city is many sights", () => {
    const p = { name: "Nalgonda", lat: 17.05, lng: 79.27, category: "other" as const, visitMin: null };
    expect(settlementOf(p, near("Nalgonda", 165_000))).toEqual({ role: "town", pop: 165_000 });
    expect(settlementOf({ ...p, name: "Visakhapatnam" }, near("Visakhapatnam", 2_000_000, "city"))).toEqual({ role: "city", pop: 2_000_000 });
  });
  it("never mistakes a sight, a known kind, or the traveller's own time for a town", () => {
    const p = { name: "Charminar", lat: 17.36, lng: 78.47, category: "other" as const, visitMin: null };
    expect(settlementOf(p, near("Hyderabad", 7_000_000, "city"))).toBeNull();           // a sight inside a city
    expect(settlementOf({ ...p, name: "Nalgonda", category: "temple" }, near("Nalgonda", 165_000))).toBeNull(); // known kind wins
    expect(settlementOf({ ...p, name: "Nalgonda", visitMin: 90 }, near("Nalgonda", 165_000))).toBeNull();      // your own time wins
    expect(settlementOf({ ...p, name: "Nalgonda" }, near("Nalgonda", 165_000, "town", 20))).toBeNull();        // too far to be it
    expect(settlementOf({ ...p, name: "Nalgonda" }, near("Nalgonda", 165_000, "sight"))).toBeNull();           // not a settlement kind
  });
  it("sets the time and says why, in plain words", () => {
    const places = makeInput([{ name: "Nalgonda", at: [17.05, 79.27] }, { name: "Lonavala", category: "hill_station" }]).places;
    const { places: out, notes } = markSettlements(places, (lat) => (lat > 17 ? near("Nalgonda", 165_000) : []));
    expect(out[0]).toMatchObject({ visitMin: SETTLEMENT_VISIT_MIN.town, settlement: "town" });
    expect(out[1]).toEqual(places[1]);
    expect(notes).toHaveLength(1); expect(notes[0]).toMatch(/Nalgonda is a town, not a sight/);
  });
  // T14 / finding F3: "Araku Valley" is a mandal (subdistrict, population ~57k) in the place index, and was timed as a 30-minute TOWN.
  it("an area (mandal / district) is never a 30-minute town: half a day, said to be a placeholder, with where to change it", () => {
    const p = { name: "Araku Valley", lat: 18.3273, lng: 82.8775, category: "other" as const, visitMin: null };
    expect(settlementOf(p, near("Araku Valley", 56_674, "subdistrict"))).toEqual({ role: "area", pop: 56_674 });   // BEFORE: role "town"
    expect(settlementOf({ ...p, name: "Krishna" }, near("Krishna", 4_500_000, "district"))).toMatchObject({ role: "area" }); // never "city" by an area's population
    const { places, notes } = markSettlements([{ ...p, id: "a", priority: "normal" as const }], () => near("Araku Valley", 56_674, "subdistrict"));
    expect(places[0]).toMatchObject({ visitMin: SETTLEMENT_VISIT_MIN.area, settlement: "area" });
    expect(SETTLEMENT_VISIT_MIN.area).toBeGreaterThanOrEqual(240);
    expect(notes[0]).toMatch(/is an area .* placeholder: set "Time there"/);
  });
  it("a name that is a town AND a district is the town (people mean the town)", () => {
    const p = { name: "Nalgonda", lat: 17.05, lng: 79.27, category: "other" as const, visitMin: null };
    expect(settlementOf(p, [{ name: "Nalgonda", kind: "district", pop: 3_400_000, km: 2 }, { name: "Nalgonda", kind: "town", pop: 165_000, km: 1 }])).toEqual({ role: "town", pop: 165_000 });
  });
  it("in a plan, the town takes a short stop, not an hour of sightseeing", () => {
    const base = makeInput([{ name: "Lonavala", category: "hill_station" }, { name: "Townsville", at: [18.6, 73.6] }], { numDays: 1, endMode: "free" });
    const { places } = markSettlements(base.places, (lat) => (lat < 18.7 ? near("Townsville", 50_000) : []));
    const plan = planTrip(engineInput({ ...base, places }, { towns: townFinder([]) }));
    const stop = plan.variants[1].option.days.flatMap((d) => d.stops).find((s) => s.name === "Townsville");
    expect(stop?.visitMin).toBe(30);
  });
});
