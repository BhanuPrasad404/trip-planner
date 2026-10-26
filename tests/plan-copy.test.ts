// Plain-words fixes found in the audit: no internal plan names, right singular/plural, no impossible day ends.
import { describe, expect, it } from "vitest";
import type { PlaceCategory } from "@/lib/categories";
import { planTrip } from "@/lib/engine/plan";
import { effectiveAnswers, emptyDraft, tripRequests } from "@/lib/intake/draft";
import { makeInput, POINTS, rng } from "./builder-fixtures";
import { engineInput, townFinder } from "./engine-fixtures";

const NAMES = Object.keys(POINTS).filter((n) => n !== "Mumbai");
const CATS: PlaceCategory[] = ["beach", "fort", "temple", "viewpoint", "lake", "hill_station", "trek", "waterfall", "museum"];

describe("messages in the plan", () => {
  it("never name the internal plan (\"explorer\"), and never say \"a explorer day\"", () => {
    for (const seed of [3, 9]) {
      const r = rng(seed);
      for (let t = 0; t < 150; t++) {
        const specs = [...NAMES].sort(() => r() - 0.5).slice(0, 3 + Math.floor(r() * 5)).map((name) => ({ name, category: CATS[Math.floor(r() * CATS.length)] }));
        const plan = planTrip(engineInput(makeInput(specs as never, { numDays: 1 + Math.floor(r() * 5), endMode: r() < 0.5 ? "start" : "free", startDateISO: "2026-12-12" }), { towns: townFinder([]) }));
        for (const v of plan.variants) for (const m of [...v.option.warnings.map((w) => w.message), ...v.option.removed.map((x) => x.reason)]) expect(m, m).not.toMatch(/explorer/i);
      }
    }
  });
  it("empty days are said with the right words, and no longer tell a Relaxed traveller to choose Relaxed", () => {
    const one = planTrip(engineInput(makeInput([{ name: "Lonavala" }], { numDays: 2, endMode: "free" }), { towns: townFinder([]) }));
    const msg = one.variants[1].option.warnings.find((w) => w.code === "empty_days")?.message ?? "";
    expect(msg).toMatch(/1 of your 2 days has nothing planned/); expect(msg).not.toMatch(/choose Relaxed/i);
    const three = planTrip(engineInput(makeInput([{ name: "Lonavala" }], { numDays: 4, endMode: "free" }), { towns: townFinder([]) }));
    expect(three.variants[1].option.warnings.find((w) => w.code === "empty_days")?.message ?? "").toMatch(/3 of your 4 days have nothing planned/);
  });
  it("no plan ends its day before the day has really begun (the daylight rule has a floor)", () => {
    for (const date of ["2026-12-20", "2027-01-05"]) for (const seed of [4, 8]) {
      const r = rng(seed);
      for (let t = 0; t < 60; t++) {
        const specs = [...NAMES].sort(() => r() - 0.5).slice(0, 4 + Math.floor(r() * 4)).map((name) => ({ name, category: CATS[Math.floor(r() * CATS.length)] }));
        const plan = planTrip(engineInput(makeInput(specs as never, { numDays: 1 + Math.floor(r() * 4), endMode: "start", startDateISO: date }), { towns: townFinder([]) }));
        for (const v of plan.variants) for (const w of v.option.warnings) expect(w.message, w.message).not.toMatch(/\b(12|1|2|3):\d\d AM\b/);
      }
    }
  });
});

describe("the trip's automatic name", () => {
  it("says \"1 day\", not \"1 days\"", () => {
    const d = { ...emptyDraft(), chosen: { days: 1 } };
    const eff = effectiveAnswers(d, []);
    expect(tripRequests(d, eff, undefined, null).trip.name).toMatch(/1 day$/);
    const d2 = { ...emptyDraft(), chosen: { days: 4 } };
    expect(tripRequests(d2, effectiveAnswers(d2, []), undefined, null).trip.name).toMatch(/4 days$/);
  });
});
