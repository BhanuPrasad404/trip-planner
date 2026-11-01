// Phase 5.4: corrections. History is never edited; a correction is a NEW event that voids or re-times one of the person's OWN events. What is
// derived (the journey's state, who is at a place) uses the corrected picture; the original stays on the timeline, marked.
import { describe, expect, it } from "vitest";
import { activeArrivalUsers, applyCorrections, buildTimeline, correctionError, correctionOf, deriveJourney, eventError, retimeTo, timeText, type JourneyEvent, type JourneyKind } from "@/lib/trip/journey";

const IST = 330;
let n = 0;
const ev = (kind: JourneyKind, ist: string, o: Partial<JourneyEvent> = {}): JourneyEvent => {
  const [d, hm] = ist.split(" ");
  return { clientEventId: `evt-${String(++n).padStart(6, "0")}`, kind, occurredAt: new Date(Date.parse(`${d}T${hm}:00Z`) - IST * 60_000).toISOString(), source: "manual", userId: "u1", ...o };
};
const iso = (ist: string) => { const [d, hm] = ist.split(" "); return new Date(Date.parse(`${d}T${hm}:00Z`) - IST * 60_000).toISOString(); };
const fix = (target: JourneyEvent, action: "void" | "retime", ist: string, at?: string, userId = "u1"): JourneyEvent => ev("manual_correction", ist, { userId, meta: { target: target.clientEventId, action, ...(at ? { at } : {}) } });
const NOW = Date.parse("2026-11-04T12:00:00Z");

describe("what a correction does", () => {
  it("'that didn't happen' on a departure puts the journey back to 'not started'; the original stays on the timeline, marked", () => {
    const dep = ev("departed", "2026-11-02 22:00");
    const all = [dep, fix(dep, "void", "2026-11-02 22:10")];
    expect(deriveJourney(all)).toMatchObject({ state: "awaiting-departure", departedAt: null });
    const row = buildTimeline(all, { offsetMin: IST, me: "u1" }).find((r) => r.key === dep.clientEventId)!;
    expect(row).toMatchObject({ corrected: "voided", own: true, kind: "departed" });
    expect(row.note).toBe("You marked this as a mistake, so it doesn't count.");
  });
  it("a corrected time is the time everything is worked out from, and the timeline says what it was", () => {
    const dep = ev("departed", "2026-11-02 22:00");
    const all = [dep, ev("arrived", "2026-11-03 02:00", { placeId: "v", placeName: "Vijayawada" }), fix(dep, "retime", "2026-11-03 09:00", iso("2026-11-02 21:00"))];
    expect(deriveJourney(all).departedAt).toBe(iso("2026-11-02 21:00"));
    const rows = buildTimeline(all, { offsetMin: IST, me: "u1" });
    expect(rows[0]).toMatchObject({ label: "Departed", corrected: "retimed", originalAt: dep.occurredAt });
    expect(rows[0].note).toBe("You corrected the time (it was 10:00 PM).");
    expect(timeText(rows[0].at, IST)).toBe("9:00 PM");
  });
  it("a wrong arrival that is voided no longer puts the traveller at that place", () => {
    const arr = ev("arrived", "2026-11-03 02:00", { placeId: "v", placeName: "Vijayawada" });
    expect(deriveJourney([ev("departed", "2026-11-02 22:00"), arr]).atPlace).not.toBeNull();
    expect(deriveJourney([ev("departed", "2026-11-02 22:00"), arr, fix(arr, "void", "2026-11-03 02:05")]).atPlace).toBeNull();
    expect(activeArrivalUsers([arr, fix(arr, "void", "2026-11-03 02:05")], "v").size).toBe(0);
  });
  it("the last word wins: re-timed, then voided", () => {
    const e = ev("departed", "2026-11-02 22:00");
    const r = applyCorrections([e, fix(e, "retime", "2026-11-02 22:30", iso("2026-11-02 21:00")), fix(e, "void", "2026-11-02 23:00")]);
    expect(r.voided.has(e.clientEventId)).toBe(true);
    expect(r.events).toEqual([]);
  });
  it("a correction made later still counts when judging an event that was made earlier (it was made offline)", () => {
    const dep = ev("departed", "2026-11-02 10:00");
    const c = fix(dep, "void", "2026-11-02 18:00");
    // judged 'as of' 12:00, after the departure but before the correction was made: the departure is already known to be a mistake
    expect(eventError([dep, c], { kind: "paused", occurredAt: iso("2026-11-02 12:00") })).toMatch(/doesn't fit/);
  });
});

describe("who and what can be corrected", () => {
  it("nobody can correct someone else's event: it is ignored whatever is sent, and the server only ever offers a person their own", () => {
    const theirs = ev("departed", "2026-11-02 22:00", { userId: "u2" });
    const r = applyCorrections([theirs, fix(theirs, "void", "2026-11-02 22:10", undefined, "u1")]);
    expect(r.voided.size).toBe(0);
    expect(r.events).toHaveLength(1);
    expect(correctionError([], { target: theirs.clientEventId, action: "void" }, NOW)).toMatch(/wasn't found among your own/);
  });
  it("a correction cannot itself be corrected, and a correction with no usable action is not a correction", () => {
    const e = ev("departed", "2026-11-02 22:00");
    const c = fix(e, "void", "2026-11-02 22:10");
    expect(correctionError([e, c], { target: c.clientEventId, action: "void" }, NOW)).toMatch(/wasn't found among your own/);
    expect(correctionOf({ ...c, meta: { target: "x", action: "explode" } })).toBeNull();
    expect(correctionOf({ ...c, meta: { target: "x", action: "retime" } })).toBeNull();
    expect(correctionOf(ev("manual_correction", "2026-11-02 22:10", { meta: { note: "Undid change 3" } }))).toBeNull(); // the plan-change undo note is only a note
  });
  it("it cannot leave the journey out of order: voiding 'left' while a pause depends on it is refused, and says to correct that first", () => {
    const dep = ev("departed", "2026-11-02 10:00"), pause = ev("paused", "2026-11-02 12:00");
    expect(correctionError([dep, pause], { target: dep.clientEventId, action: "void" }, NOW)).toBe("Other events depend on this one. Correct those first.");
    expect(correctionError([dep, pause], { target: pause.clientEventId, action: "void" }, NOW)).toBeNull();
    expect(correctionError([dep, pause], { target: dep.clientEventId, action: "retime", at: iso("2026-11-02 13:00") }, NOW)).toBe("That time would put it out of order with your other events.");
    expect(correctionError([dep, pause], { target: dep.clientEventId, action: "retime", at: iso("2026-11-02 09:00") }, NOW)).toBeNull();
  });
  it("a new time must be real: not in the future, not older than the outbox keeps, not the time it already has", () => {
    const e = ev("arrived", "2026-11-03 02:00", { placeId: "v" });
    expect(correctionError([e], { target: e.clientEventId, action: "retime", at: new Date(NOW + 3_600_000).toISOString() }, NOW)).toBe("That time is in the future.");
    expect(correctionError([e], { target: e.clientEventId, action: "retime", at: new Date(NOW - 20 * 86_400_000).toISOString() }, NOW)).toBe("That is too long ago to change safely.");
    expect(correctionError([e], { target: e.clientEventId, action: "retime", at: e.occurredAt }, NOW)).toBe("That is the time it already has.");
    expect(correctionError([e], { target: e.clientEventId, action: "retime", at: "nonsense" }, NOW)).toBe("That time isn't valid.");
    expect(correctionError([e], { target: e.clientEventId, action: "retime", at: iso("2026-11-03 02:10") }, NOW)).toBeNull();
  });
  it("an event already voided can't be voided again", () => {
    const e = ev("arrived", "2026-11-03 02:00", { placeId: "v" });
    expect(correctionError([e, fix(e, "void", "2026-11-03 02:05")], { target: e.clientEventId, action: "void" }, NOW)).toBe("That event was already marked as a mistake.");
  });
  it("retimeTo puts a time of day on the same India date, and refuses a bad time", () => {
    expect(retimeTo("2026-11-02T20:37:00Z", "01:30", 330)).toBe("2026-11-02T20:00:00.000Z"); // 2:07 AM IST on 3 Nov -> 1:30 AM the same IST date
    expect(retimeTo("2026-11-02T16:30:00Z", "22:15", 330)).toBe("2026-11-02T16:45:00.000Z"); // 10:00 PM IST on 2 Nov -> 10:15 PM
    expect(retimeTo("2026-11-02T16:30:00Z", "25:00", 330)).toBeNull();
    expect(retimeTo("junk", "10:00", 330)).toBeNull();
  });
});
