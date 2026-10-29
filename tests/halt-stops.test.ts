import { describe, expect, it } from "vitest";
import { haltRows, PLAN_HALT_SOURCE } from "@/lib/engine/halt-stops";
import type { TransitDay } from "@/lib/engine/types";

// Made-up drive days (no real place is assumed): each ends at a halt town with a position.
const day = (over: Partial<TransitDay>): TransitDay => ({ day: 1, from: "Start Town", to: "Halt Town", driveMin: 493.4, km: 549.96, haltNote: null, daylightLimited: false, at: { lat: 16.5, lng: 74.5 }, ...over });
let n = 0;
const id = () => `id-${++n}`;

describe("a drive day becomes one saved stop", () => {
  it("named after the halt town, at its position, with the day's driving time and distance, as a place to stay made by the plan", () => {
    const [h] = haltRows([day({})], "trip-1", "user-1", id);
    expect(h).toMatchObject({ trip_id: "trip-1", name: "Halt Town", lat: 16.5, lng: 74.5, day_number: 1, sequence_order: 1, arrival_time: null, drive_minutes: 493, drive_km: 550, category: "stay", source_type: PLAN_HALT_SOURCE, added_by: "user-1", notes: null });
  });
  it("keeps the 'check stays here' note, and trims long names", () => {
    const [h] = haltRows([day({ haltNote: "check stays here", to: "X".repeat(300) })], "t", "u", id);
    expect(h.notes).toBe("check stays here"); expect(h.name).toHaveLength(120);
  });
  it("outbound and return drive days each get their own", () => {
    const rows = haltRows([day({ day: 1 }), day({ day: 5, to: "Second Halt" }), day({ day: 6, to: "Start Town", at: { lat: 17.4, lng: 78.5 } })], "t", "u", id);
    expect(rows.map((r) => [r.day_number, r.name])).toEqual([[1, "Halt Town"], [5, "Second Halt"], [6, "Start Town"]]);
  });
  it("a day with no known end position gets none (nothing to navigate to), and so does bad data", () => {
    const bad = haltRows([day({ at: undefined }), day({ day: 2, at: { lat: NaN, lng: 1 } }), day({ day: 3, at: { lat: 120, lng: 1 } }), day({ day: 0 }), day({ day: 1.5 })], "t", "u", id);
    expect(bad).toEqual([]);
  });
  it("one halt per day, even if the engine listed a day twice; a missing name gets a plain one; bad numbers become 0", () => {
    const rows = haltRows([day({ day: 2 }), day({ day: 2, to: "Dup" }), day({ day: 3, to: "  ", driveMin: NaN, km: -5 })], "t", "u", id);
    expect(rows.map((r) => r.day_number)).toEqual([2, 3]);
    expect(rows[1]).toMatchObject({ name: "Overnight halt", drive_minutes: 0, drive_km: 0 });
  });
});
