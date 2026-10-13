import { describe, expect, it } from "vitest";
import { previewDateChange, stopsLeavingForDays, summarizeTripDates } from "@/lib/trip-dates";
import { updateTripSchema } from "@/lib/validation/schemas";

describe("summarizeTripDates", () => {
  it("a trip with dates shows the first and last day and the real number of days", () => {
    const s = summarizeTripDates("2026-10-14", 3);
    expect(s).toMatchObject({ hasDates: true, days: 3, firstISO: "2026-10-14", lastISO: "2026-10-16" });
    expect(s.rangeLabel).toContain("14 Oct"); expect(s.rangeLabel).toContain("16 Oct"); expect(s.rangeLabel).toContain("2026"); expect(s.rangeLabel).toContain("→");
  });
  it("crosses months and years correctly", () => {
    expect(summarizeTripDates("2026-12-30", 4).lastISO).toBe("2027-01-02");
  });
  it("a one-day trip shows a single date", () => {
    const s = summarizeTripDates("2026-10-14", 1);
    expect(s.rangeLabel).not.toContain("→"); expect(s.days).toBe(1);
  });
  it("no date, an impossible date, or nonsense length never invents dates", () => {
    expect(summarizeTripDates(null, 3)).toMatchObject({ hasDates: false, rangeLabel: "No dates yet", days: 3 });
    expect(summarizeTripDates("2026-02-31", 3).hasDates).toBe(false);
    expect(summarizeTripDates("2026-10-14", NaN).days).toBe(1);
  });
});

describe("stopsLeavingForDays", () => {
  it("counts only the stops on days beyond the new length", () => {
    expect(stopsLeavingForDays({ 1: 2, 2: 3, 3: 1, 4: 2 }, 2)).toBe(3);
    expect(stopsLeavingForDays({ 1: 2, 2: 3 }, 5)).toBe(0);
    expect(stopsLeavingForDays({}, 1)).toBe(0);
  });
});

describe("previewDateChange: what the edit would mean, before saving", () => {
  const base = { currentStart: "2026-10-14", currentDays: 4, countsByDay: { 1: 2, 2: 2, 3: 1, 4: 1 } };
  it("shortening warns how many stops go back to Ideas", () => {
    const p = previewDateChange({ ...base, startDate: "2026-10-14", numDays: 2 });
    expect(p).toMatchObject({ movingToIdeas: 2, changed: true, valid: true, problem: null });
    expect(p.endLabel).toContain("15 Oct");
  });
  it("lengthening or moving the start moves no stops", () => {
    expect(previewDateChange({ ...base, startDate: "2026-10-14", numDays: 6 }).movingToIdeas).toBe(0);
    expect(previewDateChange({ ...base, startDate: "2026-11-01", numDays: 4 })).toMatchObject({ movingToIdeas: 0, changed: true });
  });
  it("no change is reported as no change", () => {
    expect(previewDateChange({ ...base, startDate: "2026-10-14", numDays: 4 }).changed).toBe(false);
  });
  it("out-of-range and impossible input is a clear problem, not a guess", () => {
    expect(previewDateChange({ ...base, startDate: "2026-10-14", numDays: 0 })).toMatchObject({ valid: false, problem: "Choose between 1 and 30 days." });
    expect(previewDateChange({ ...base, startDate: "2026-10-14", numDays: 31 }).valid).toBe(false);
    expect(previewDateChange({ ...base, startDate: "2026-02-31", numDays: 3 })).toMatchObject({ valid: false, problem: "That is not a real date." });
  });
  it("clearing the date is allowed and means 'no dates'", () => {
    expect(previewDateChange({ ...base, startDate: null, numDays: 4 })).toMatchObject({ valid: true, changed: true, endLabel: null });
  });
});

describe("updateTripSchema", () => {
  it("accepts a date, a length, both, or a cleared date", () => {
    expect(updateTripSchema.safeParse({ start_date: "2026-10-14" }).success).toBe(true);
    expect(updateTripSchema.safeParse({ num_days: 5 }).success).toBe(true);
    expect(updateTripSchema.safeParse({ start_date: "2026-10-14", num_days: 5 }).success).toBe(true);
    expect(updateTripSchema.safeParse({ start_date: null }).success).toBe(true);
  });
  it("rejects nothing-to-change, impossible dates, wrong formats and bad lengths", () => {
    for (const bad of [{}, { start_date: "2026-02-31" }, { start_date: "14/10/2026" }, { start_date: "2026-13-01" }, { num_days: 0 }, { num_days: 31 }, { num_days: 2.5 }, { num_days: "3" }]) {
      expect(updateTripSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
