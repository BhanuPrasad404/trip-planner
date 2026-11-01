// Phase 5.2 and 5.3: each person's OWN journey in a group, and the traveller's own preferences.
import { describe, expect, it } from "vitest";
import { arrivedCount, memberProgress } from "@/lib/trip/group";
import { DEFAULT_PREFS, PACE_WINDOW, PACES, parsePrefs, prefsKey } from "@/lib/trip/preferences";
import type { JourneyEvent, JourneyKind } from "@/lib/trip/journey";

const IST = 330;
let n = 0;
const ev = (kind: JourneyKind, ist: string, userId: string, o: Partial<JourneyEvent> = {}): JourneyEvent => {
  const [d, hm] = ist.split(" ");
  return { clientEventId: `evt-${String(++n).padStart(6, "0")}`, kind, occurredAt: new Date(Date.parse(`${d}T${hm}:00Z`) - IST * 60_000).toISOString(), source: "manual", userId, ...o };
};
const members = [{ user_id: "u1", display_name: "Bhanu" }, { user_id: "u2", display_name: "Anil" }, { user_id: "u3", display_name: null }];

describe("a group: each person's own journey", () => {
  const events = [
    ev("departed", "2026-11-02 22:00", "u1"), ev("arrived", "2026-11-03 02:00", "u1", { placeId: "v", placeName: "Vijayawada" }),
    ev("departed", "2026-11-03 06:00", "u2"), ev("paused", "2026-11-03 08:00", "u2"),
    ev("visit_completed", "2026-11-03 11:00", "u1", { placeId: "k" }), ev("visit_skipped", "2026-11-03 12:00", "u1", { placeId: "f" }),
  ];
  const p = memberProgress(events, members, "u1");
  it("one person arriving does not mean the group arrived; one person pausing does not pause the others", () => {
    expect(p.find((m) => m.userId === "u1")).toMatchObject({ you: true, state: "travelling", atPlace: { placeId: "v", name: "Vijayawada" } });
    expect(p.find((m) => m.userId === "u2")).toMatchObject({ you: false, state: "paused", atPlace: null });
  });
  it("a member who has recorded nothing is listed as not set off, never left out; a member with no name gets a plain one", () => {
    expect(p.find((m) => m.userId === "u3")).toMatchObject({ name: "Someone on the trip", state: "awaiting-departure", visited: 0, lastEventAt: null });
    expect(p).toHaveLength(3);
  });
  it("visited and skipped are counted per person, from that person's own events", () => {
    expect(p.find((m) => m.userId === "u1")).toMatchObject({ visited: 1, skipped: 1 });
    expect(p.find((m) => m.userId === "u2")).toMatchObject({ visited: 0, skipped: 0 });
  });
  it("a visit a person then corrected back to planned is not counted for them", () => {
    const more = [...events, ev("visit_corrected", "2026-11-03 13:00", "u1", { placeId: "k" })];
    expect(memberProgress(more, members, "u1").find((m) => m.userId === "u1")).toMatchObject({ visited: 0, skipped: 1 });
  });
  it("a person's voided event is not counted for them either", () => {
    const dep = ev("departed", "2026-11-04 08:00", "u3");
    const voided = ev("manual_correction", "2026-11-04 08:05", "u3", { meta: { target: dep.clientEventId, action: "void" } });
    expect(memberProgress([dep, voided], members, "u1").find((m) => m.userId === "u3")?.state).toBe("awaiting-departure");
  });
  it("how many are at a place right now is individual arrivals, out of the group", () => {
    expect(arrivedCount(p, "v")).toEqual({ at: 1, of: 3 });
    expect(arrivedCount(p, "elsewhere")).toEqual({ at: 0, of: 3 });
  });
  it("the last thing each person did is when they were last heard from", () => {
    expect(p.find((m) => m.userId === "u2")!.lastEventAt).toBe(events[3].occurredAt);
  });
  it("uses no position at all: there is none in what it is built from", () => {
    expect(JSON.stringify(p)).not.toMatch(/lat|lng|coord|position/i);
  });
});

describe("the traveller's own preferences", () => {
  it("default to a balanced day and no night driving", () => {
    expect(DEFAULT_PREFS).toEqual({ nightDriving: false, pace: "balanced" });
    expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS); expect(parsePrefs(null)).toEqual(DEFAULT_PREFS); expect(parsePrefs("junk")).toEqual(DEFAULT_PREFS); expect(parsePrefs({})).toEqual(DEFAULT_PREFS);
  });
  it("read back field by field: one damaged value never spoils the other", () => {
    expect(parsePrefs({ nightDriving: true, pace: "hurry" })).toEqual({ nightDriving: true, pace: "balanced" });
    expect(parsePrefs({ nightDriving: "yes", pace: "brisk" })).toEqual({ nightDriving: false, pace: "brisk" });
  });
  it("night driving is only ever on when the traveller set it to exactly true", () => {
    for (const v of [1, "true", "on", {}, []]) expect(parsePrefs({ nightDriving: v }).nightDriving).toBe(false);
    expect(parsePrefs({ nightDriving: true }).nightDriving).toBe(true);
  });
  it("each pace is a real day: relaxed starts later and ends earlier than balanced, brisk the reverse", () => {
    expect(PACES).toEqual(["relaxed", "balanced", "brisk"]);
    expect(PACE_WINDOW.relaxed.dayStartMin).toBeGreaterThan(PACE_WINDOW.balanced.dayStartMin);
    expect(PACE_WINDOW.relaxed.dayEndMin).toBeLessThan(PACE_WINDOW.balanced.dayEndMin);
    expect(PACE_WINDOW.brisk.dayStartMin).toBeLessThan(PACE_WINDOW.balanced.dayStartMin);
    expect(PACE_WINDOW.brisk.dayEndMin).toBeGreaterThan(PACE_WINDOW.balanced.dayEndMin);
    for (const p of PACES) { const w = PACE_WINDOW[p]; expect(w.dayEndMin - w.dayStartMin).toBeGreaterThanOrEqual(9 * 60); expect(w.dayEndMin).toBeLessThanOrEqual(23 * 60); }
  });
  it("are kept per person on the phone", () => {
    expect(prefsKey("u1")).toBe("tm:travel-prefs:u1");
    expect(prefsKey("u1")).not.toBe(prefsKey("u2"));
  });
});
