import { describe, expect, it } from "vitest";
import { clockLabel, dayEndFrom, isClosed, isResumed, lifecycleChip, lifecycleOf, resumedDay } from "@/lib/trip/lifecycle";
import { liveDayFor, tripOutcome, tripState } from "@/lib/trip-state";
import { tripLifecycleSchema } from "@/lib/validation/schemas";

const past = { start_date: "2026-10-01", num_days: 2 };   // planned 1-2 Oct: over by 15 Oct
const future = { start_date: "2026-11-01", num_days: 2 };
const live = { start_date: "2026-10-14", num_days: 3 };
const TODAY = "2026-10-15";
const none = { stops: 4, done: 0, skipped: 0 };

describe("lifecycleOf: what really happened, apart from what was planned", () => {
  it("a planned trip whose dates have passed and nothing was done is 'expired, never started': NOT completed", () => {
    expect(lifecycleOf(past, TODAY, none)).toEqual({ kind: "expired-never-started" });
    expect(tripState(past, TODAY)).toBe("completed"); // the planned dates alone say completed; the lifecycle (and outcome wording) do not
    expect(tripOutcome("completed", none).label).toBe("Dates passed");
    expect(lifecycleChip({ kind: "expired-never-started" })).toEqual({ label: "Dates passed", kind: "ended", pulse: false });
  });
  it("an empty trip with no stops at all whose dates passed is also 'never started' (nothing to continue)", () => {
    expect(lifecycleOf(past, TODAY, { stops: 0, done: 0, skipped: 0 }).kind).toBe("expired-never-started");
  });
  it("dates passed after real progress is 'expired, started': progress is reported, not discarded", () => {
    expect(lifecycleOf(past, TODAY, { stops: 5, done: 2, skipped: 1 })).toEqual({ kind: "expired-started", done: 2, skipped: 1, remaining: 2, stops: 5 });
    expect(lifecycleOf(past, TODAY, { stops: 3, done: 3, skipped: 0 })).toMatchObject({ kind: "expired-started", remaining: 0 });
  });
  it("skipping a stop on the road counts as having started", () => {
    expect(lifecycleOf(past, TODAY, { stops: 3, done: 0, skipped: 1 }).kind).toBe("expired-started");
  });
  it("draft, upcoming and active trips have no lifecycle prompt", () => {
    expect(lifecycleOf({ start_date: null, num_days: 2 }, TODAY, none).kind).toBe("normal");
    expect(lifecycleOf(future, TODAY, none).kind).toBe("normal");
    expect(lifecycleOf(live, TODAY, none).kind).toBe("normal");
  });
  it("a resumed trip is 'resumed' whatever its planned dates say, with what is left", () => {
    for (const t of [past, future, live, { start_date: null, num_days: 1 }]) expect(lifecycleOf({ ...t, resumed_at: "2026-10-15T04:00:00Z" }, TODAY, { stops: 5, done: 2, skipped: 1 })).toEqual({ kind: "resumed", since: "2026-10-15T04:00:00Z", remaining: 2 });
  });
  it("a closed trip is history: finished or cancelled, with when, whatever else is true", () => {
    expect(lifecycleOf({ ...past, closed_at: "2026-10-10T00:00:00Z", closed_reason: "finished" }, TODAY, none)).toEqual({ kind: "closed", reason: "finished", at: "2026-10-10T00:00:00Z" });
    expect(lifecycleOf({ ...live, resumed_at: "2026-10-14T00:00:00Z", closed_at: "2026-10-15T00:00:00Z", closed_reason: "cancelled" }, TODAY, none)).toMatchObject({ kind: "closed", reason: "cancelled" });
    expect(lifecycleOf({ ...future, closed_at: "2026-10-10T00:00:00Z", closed_reason: null }, TODAY, none)).toMatchObject({ kind: "closed", reason: "finished" }); // a missing reason is never invented as 'cancelled'
  });
  it("junk in the stored values is ignored, never trusted", () => {
    expect(lifecycleOf({ ...past, resumed_at: "not a date" }, TODAY, none).kind).toBe("expired-never-started");
    expect(lifecycleOf({ ...past, closed_at: "" }, TODAY, none).kind).toBe("expired-never-started");
    expect(lifecycleOf({ ...past, resumed_at: null, closed_at: null }, TODAY, none).kind).toBe("expired-never-started");
  });
  it("with no trustworthy today, no state is claimed", () => {
    expect(lifecycleOf(past, "", none).kind).toBe("normal");
  });
  it("never reports negative remaining stops, however the counts disagree", () => {
    expect(lifecycleOf({ ...past, resumed_at: "2026-10-15T04:00:00Z" }, TODAY, { stops: 2, done: 3, skipped: 1 })).toMatchObject({ remaining: 0 });
  });
});

describe("isResumed / isClosed", () => {
  it("resumed means resumed and not closed", () => {
    expect(isResumed({ resumed_at: "2026-10-15T04:00:00Z" })).toBe(true);
    expect(isResumed({ resumed_at: "2026-10-15T04:00:00Z", closed_at: "2026-10-15T09:00:00Z" })).toBe(false);
    expect(isResumed({})).toBe(false); expect(isResumed({ resumed_at: "garbage" })).toBe(false);
    expect(isClosed({ closed_at: "2026-10-15T09:00:00Z" })).toBe(true); expect(isClosed({ closed_at: null })).toBe(false);
  });
});

describe("resumedDay: which day a resumed trip works on", () => {
  const p = (day: number | null, status: string | null = "planned") => ({ day_number: day, status });
  it("is the first day that still has a stop to do", () => {
    expect(resumedDay([p(1, "done"), p(1, "skipped"), p(2), p(3)], 3)).toBe(2);
    expect(resumedDay([p(2), p(1)], 3)).toBe(1);
  });
  it("when everything is done or skipped it is the last day with stops (nothing is reset)", () => {
    expect(resumedDay([p(1, "done"), p(2, "skipped")], 3)).toBe(2);
  });
  it("with no scheduled stops it is day 1; ideas without a day do not count", () => {
    expect(resumedDay([], 3)).toBe(1); expect(resumedDay([p(null)], 3)).toBe(1);
  });
  it("never a day the trip does not have", () => {
    expect(resumedDay([p(7)], 2)).toBe(1); expect(resumedDay([p(0)], 2)).toBe(1); expect(resumedDay([p(1)], Number.NaN)).toBe(1);
  });
  it("a missing status means planned", () => { expect(resumedDay([{ day_number: 2 }], 3)).toBe(2); });
});

describe("liveDayFor with a resumed trip", () => {
  it("runs TODAY on the chosen day even though the planned dates are over, are in the future, or do not exist", () => {
    for (const t of [past, future, { start_date: null, num_days: 3 }]) expect(liveDayFor({ ...t, num_days: 3 }, TODAY, { resumedDay: 2 })).toEqual({ mode: "today", day: 2 });
  });
  it("without a resumed day it behaves exactly as before (past dates are a preview, the first day after the end an overrun)", () => {
    expect(liveDayFor(past, TODAY)).toEqual({ mode: "preview", day: null });
    expect(liveDayFor(past, "2026-10-03")).toEqual({ mode: "overrun", day: 2 });
    expect(liveDayFor(live, TODAY)).toEqual({ mode: "today", day: 2 });
  });
  it("an impossible resumed day is ignored, not trusted", () => {
    for (const d of [0, -1, 4, 1.5, Number.NaN]) expect(liveDayFor({ ...past, num_days: 3 }, TODAY, { resumedDay: d })).toEqual({ mode: "preview", day: null });
  });
});

describe("dayEndFrom and clockLabel: the traveller's time budget", () => {
  it("departure plus the hours they have, as a time of day", () => {
    expect(dayEndFrom(9 * 60, 4)).toBe(13 * 60); expect(dayEndFrom(17 * 60 + 30, 4)).toBe(21 * 60 + 30); expect(dayEndFrom(8 * 60, 1.5)).toBe(9 * 60 + 30);
  });
  it("never runs past the end of the day (it is capped at 23:59), and never invalid", () => {
    expect(dayEndFrom(20 * 60, 12)).toBe(1439);
    for (const [d, h] of [[-1, 2], [1440, 2], [600, 0], [600, -3], [600, 25], [Number.NaN, 2], [600, Number.NaN]] as const) expect(dayEndFrom(d, h)).toBeNull();
  });
  it("reads as people read it", () => {
    expect(clockLabel(0)).toBe("12:00 am"); expect(clockLabel(12 * 60)).toBe("12:00 pm"); expect(clockLabel(21 * 60 + 30)).toBe("9:30 pm"); expect(clockLabel(9 * 60 + 5)).toBe("9:05 am");
  });
});

describe("lifecycleChip", () => {
  it("each state has its own honest label; a normal trip has none", () => {
    expect(lifecycleChip({ kind: "normal" })).toBeNull();
    expect(lifecycleChip({ kind: "resumed", since: "x", remaining: 1 })).toEqual({ label: "Resumed", kind: "active", pulse: true });
    expect(lifecycleChip({ kind: "closed", reason: "finished", at: "x" })).toEqual({ label: "Finished", kind: "completed", pulse: false });
    expect(lifecycleChip({ kind: "closed", reason: "cancelled", at: "x" })).toEqual({ label: "Cancelled", kind: "ended", pulse: false });
    expect(lifecycleChip({ kind: "expired-started", done: 1, skipped: 0, remaining: 2, stops: 3 })?.label).toBe("Dates passed · in progress");
  });
});

describe("tripLifecycleSchema: only the four decisions, nothing free-form", () => {
  it.each([[{ action: "resume" }], [{ action: "resume", day_end_min: 1290 }], [{ action: "finish" }], [{ action: "cancel" }], [{ action: "reopen" }]])("accepts %j", (b) => expect(tripLifecycleSchema.safeParse(b).success).toBe(true));
  it.each([[{}], [{ action: "delete" }], [{ action: "resume", day_end_min: 1440 }], [{ action: "resume", day_end_min: -1 }], [{ action: "resume", day_end_min: 1.5 }], [{ action: "resume", day_end_min: "late" }]])("rejects %j", (b) => expect(tripLifecycleSchema.safeParse(b).success).toBe(false));
  it("ignores fields it does not know (a client cannot smuggle in a date change)", () => {
    const r = tripLifecycleSchema.safeParse({ action: "finish", start_date: "2030-01-01", closed_reason: "cancelled" });
    expect(r.success).toBe(true); expect(r.success && Object.keys(r.data)).toEqual(["action"]);
  });
});
