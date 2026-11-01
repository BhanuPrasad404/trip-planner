// Phase 1: the journey as events, and what it means (lib/trip/journey.ts). Midnight, offline ordering, duplicates, invalid transitions,
// and a timeline that never presents an inference as something the phone recorded.
import { describe, expect, it } from "vitest";
import { allowedActions, buildTimeline, dateText, deriveJourney, eventError, journeyAsOf, kindForProgress, timeText, transitionError, type JourneyEvent, type JourneyKind } from "@/lib/trip/journey";

const IST = 330;
let n = 0;
/** An event at an IST wall-clock time: ev("departed", "2026-11-02 22:00"). */
const ev = (kind: JourneyKind, ist: string, o: Partial<JourneyEvent> = {}): JourneyEvent => {
  const [d, hm] = ist.split(" ");
  return { clientEventId: `evt-${String(++n).padStart(6, "0")}`, kind, occurredAt: new Date(Date.parse(`${d}T${hm}:00Z`) - IST * 60_000).toISOString(), source: "manual", userId: "u1", ...o };
};

describe("states", () => {
  it("a trip with no events is awaiting departure: passing the planned time starts nothing", () => {
    expect(deriveJourney([])).toMatchObject({ state: "awaiting-departure", since: null, departedAt: null });
  });
  it("departed → travelling; paused → paused; resumed → travelling; rest → resting; rest ended → travelling", () => {
    const e = [ev("departed", "2026-11-02 22:00"), ev("paused", "2026-11-02 23:00"), ev("resumed", "2026-11-02 23:20"), ev("rest_started", "2026-11-03 02:15"), ev("rest_ended", "2026-11-03 08:00")];
    const states = e.map((_, i) => deriveJourney(e.slice(0, i + 1)).state);
    expect(states).toEqual(["travelling", "paused", "travelling", "resting", "travelling"]);
  });
  it("the real example: leave 10 PM, arrive 2 AM, rest, resume 8 AM, visit: one journey, nothing completed by the date changing", () => {
    const e = [ev("departed", "2026-11-02 22:00"), ev("arrived", "2026-11-03 02:00", { placeId: "v", placeName: "Vijayawada" }), ev("rest_started", "2026-11-03 02:15"), ev("rest_ended", "2026-11-03 08:00"), ev("arrived", "2026-11-03 09:30", { placeId: "k", placeName: "Kanaka Durga Temple" }), ev("visit_completed", "2026-11-03 11:00", { placeId: "k" })];
    const j = deriveJourney(e);
    expect(j.state).toBe("travelling");
    expect(j.departedAt).toBe(e[0].occurredAt);
    expect(j.atPlace).toBeNull(); // visited and left
    expect(j.ignored).toEqual([]);
    expect(deriveJourney(e.slice(0, 2)).atPlace).toMatchObject({ placeId: "v", name: "Vijayawada" }); // at 2 AM: arrived, not finished
  });
  it("midnight alone changes nothing: no event, no change of state", () => {
    const e = [ev("departed", "2026-11-02 23:30")];
    expect(deriveJourney(e).state).toBe("travelling");
    expect(journeyAsOf(e, "2026-11-04T00:00:00Z").state).toBe("travelling"); // two days later, still on the road until the traveller says otherwise
  });
  it("arriving at a stop clears when it is corrected, skipped or completed; resuming from rest clears it too", () => {
    const base = [ev("departed", "2026-11-02 10:00"), ev("arrived", "2026-11-02 12:00", { placeId: "a", placeName: "A" })];
    expect(deriveJourney([...base, ev("arrival_corrected", "2026-11-02 12:05", { placeId: "a" })]).atPlace).toBeNull();
    expect(deriveJourney([...base, ev("visit_skipped", "2026-11-02 12:05", { placeId: "a" })]).atPlace).toBeNull();
    expect(deriveJourney([...base, ev("visit_completed", "2026-11-02 12:05", { placeId: "b" })]).atPlace).toMatchObject({ placeId: "a" }); // a different stop
  });
});

describe("transitions", () => {
  const cases: [string, JourneyKind[], JourneyKind, boolean][] = [
    ["a second departure while on the road", ["departed"], "departed", false],
    ["pausing before leaving", [], "paused", false],
    ["resting before leaving", [], "rest_started", false],
    ["resuming when not paused", ["departed"], "resumed", false],
    ["ending a rest that never started", ["departed"], "rest_ended", false],
    ["pausing while resting", ["departed", "rest_started"], "paused", false],
    ["resting while paused", ["departed", "paused"], "rest_started", true],
    ["resting while travelling", ["departed"], "rest_started", true],
    ["leaving again after the journey was paused (it must be resumed instead)", ["departed", "paused"], "departed", false],
  ];
  for (const [name, before, kind, ok] of cases) {
    it(`${name}: ${ok ? "allowed" : "refused with a reason"}`, () => {
      let t = 0;
      const events = before.map((k) => ev(k, `2026-11-02 ${String(10 + t++).padStart(2, "0")}:00`));
      const err = eventError(events, { kind, occurredAt: new Date(Date.parse("2026-11-03T00:00:00Z")).toISOString() });
      if (ok) expect(err).toBeNull(); else expect(err).toMatch(/doesn't fit/);
    });
  }
  it("arriving, visiting, skipping, correcting are recordable in any state (progress is never refused)", () => {
    for (const k of ["arrived", "visit_completed", "visit_skipped", "visit_corrected", "arrival_corrected", "unplanned_stop_added", "manual_correction"] as JourneyKind[]) {
      expect(transitionError("awaiting-departure", k)).toBeNull();
      expect(transitionError("resting", k)).toBeNull();
    }
  });
  it("an arrival with no departure is KEPT, and the timeline says so instead of inventing a departure", () => {
    const e = [ev("arrived", "2026-11-03 02:00", { placeName: "Vijayawada" })];
    expect(deriveJourney(e)).toMatchObject({ state: "awaiting-departure", departedAt: null, ignored: [] });
    const rows = buildTimeline(e, { offsetMin: IST, me: "u1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("No departure was recorded before this.");
  });
  it("buttons for each state, and none once the trip is closed", () => {
    expect(allowedActions("awaiting-departure")).toEqual(["departed"]);
    expect(allowedActions("travelling")).toEqual(["paused", "rest_started"]);
    expect(allowedActions("paused")).toEqual(["resumed", "rest_started"]);
    expect(allowedActions("resting")).toEqual(["rest_ended"]);
    for (const s of ["awaiting-departure", "travelling", "paused", "resting"] as const) expect(allowedActions(s, true)).toEqual([]);
  });
});

describe("order and duplicates: events are judged by when they happened, not when they were heard", () => {
  it("an offline 'paused' heard AFTER a later 'resumed' is judged in its place in time", () => {
    const dep = ev("departed", "2026-11-02 10:00");
    const resumed = ev("resumed", "2026-11-02 12:00", { recordedAt: "2026-11-02T06:30:00Z" });
    const pausedLate = ev("paused", "2026-11-02 11:00", { recordedAt: "2026-11-02T20:00:00Z" }); // made at 11:00, heard at night
    expect(eventError([dep], { kind: "paused", occurredAt: pausedLate.occurredAt })).toBeNull();
    expect(deriveJourney([dep, resumed, pausedLate]).state).toBe("travelling"); // departed, paused 11:00, resumed 12:00
    expect(deriveJourney([dep, resumed, pausedLate]).ignored).toEqual([]);
  });
  it("an event that does not fit is kept in the history but does not change the state, and says why", () => {
    const j = deriveJourney([ev("departed", "2026-11-02 10:00"), ev("departed", "2026-11-02 11:00")]);
    expect(j.state).toBe("travelling");
    expect(j.departedAt).toBe(new Date(Date.parse("2026-11-02T10:00:00Z") - IST * 60_000).toISOString()); // the first departure stands
    expect(j.ignored).toHaveLength(1);
    expect(j.ignored[0].reason).toMatch(/on the road/);
  });
  it("the same event twice counts once", () => {
    const d = ev("departed", "2026-11-02 10:00");
    expect(deriveJourney([d, { ...d }, ev("paused", "2026-11-02 11:00")]).state).toBe("paused");
    expect(deriveJourney([d, { ...d }]).ignored).toEqual([]);
  });
  it("a damaged time is dropped, never guessed", () => {
    expect(deriveJourney([{ ...ev("departed", "2026-11-02 10:00"), occurredAt: "nonsense" }]).state).toBe("awaiting-departure");
  });
  it("events at the same instant are ordered by when they were heard, whatever order they are given in", () => {
    const a = { ...ev("departed", "2026-11-02 10:00"), recordedAt: "2026-11-02T10:00:01Z" };
    const b = { ...ev("paused", "2026-11-02 10:00"), recordedAt: "2026-11-02T10:00:02Z" };
    expect(deriveJourney([a, b]).state).toBe("paused");
    expect(deriveJourney([b, a]).state).toBe("paused");
  });
});

describe("the timeline", () => {
  const e = [
    ev("departed", "2026-11-02 22:00", { source: "gps", accuracyM: 12, meta: { from: "Hyderabad" } }),
    ev("arrived", "2026-11-03 02:00", { placeId: "v", placeName: "Vijayawada" }),
    ev("rest_started", "2026-11-03 02:15"),
    ev("rest_ended", "2026-11-03 08:00"),
    ev("arrived", "2026-11-03 09:30", { placeId: "k", placeName: "Kanaka Durga Temple" }),
    ev("visit_completed", "2026-11-03 11:00", { placeId: "k", placeName: "Kanaka Durga Temple" }),
  ];
  const rows = buildTimeline(e, { offsetMin: IST, me: "u1", nowMs: Date.parse("2026-11-03T12:00:00Z") });
  it("reads like the traveller's own story, in order, with India times", () => {
    expect(rows.map((r) => `${timeText(r.at, IST)} ${r.label}`)).toEqual([
      "10:00 PM Departed from Hyderabad",
      "12:00 AM Journey continued into Tue 3 Nov",
      "2:00 AM Arrived at Vijayawada",
      "2:15 AM Rest started",
      "8:00 AM Rest ended",
      "9:30 AM Arrived at Kanaka Durga Temple",
      "11:00 AM Visit completed: Kanaka Durga Temple",
    ]);
  });
  it("the midnight line is INFERRED and says so: never shown as a recorded event", () => {
    const mid = rows.find((r) => r.key.startsWith("midnight:"))!;
    expect(mid.certainty).toBe("inferred");
    expect(mid.note).toMatch(/nothing was recorded/);
    expect(rows.filter((r) => r.certainty !== "inferred").every((r) => r.certainty === "gps" || r.certainty === "manual")).toBe(true);
  });
  it("how sure each line is follows how it was recorded", () => {
    expect(rows[0].certainty).toBe("gps");
    expect(rows[2].certainty).toBe("manual");
  });
  it("no midnight line while resting or paused, only while on the road", () => {
    const sleep = [ev("departed", "2026-11-02 20:00"), ev("rest_started", "2026-11-02 21:00"), ev("rest_ended", "2026-11-04 09:00")];
    const r = buildTimeline(sleep, { offsetMin: IST, me: "u1" });
    expect(r.filter((x) => x.key.startsWith("midnight:"))).toEqual([]);
  });
  it("a journey still on the road shows the midnights crossed up to now (and none in the future)", () => {
    const r = buildTimeline([ev("departed", "2026-11-02 22:00")], { offsetMin: IST, me: "u1", nowMs: Date.parse("2026-11-04T12:00:00Z") });
    expect(r.filter((x) => x.key.startsWith("midnight:")).map((x) => x.label)).toEqual(["Journey continued into Tue 3 Nov", "Journey continued into Wed 4 Nov"]);
    expect(buildTimeline([ev("departed", "2026-11-02 22:00")], { offsetMin: IST, me: "u1" }).filter((x) => x.key.startsWith("midnight:"))).toEqual([]); // no "now": nothing assumed
  });
  it("events waiting to be sent are shown as such, never as recorded, and not twice once they arrive", () => {
    const wait = ev("paused", "2026-11-03 12:00");
    const r = buildTimeline([ev("departed", "2026-11-03 10:00")], { offsetMin: IST, me: "u1", pending: [wait] });
    expect(r.find((x) => x.key === wait.clientEventId)!.certainty).toBe("pending");
    const after = buildTimeline([ev("departed", "2026-11-03 10:00"), wait], { offsetMin: IST, me: "u1", pending: [wait] });
    expect(after.filter((x) => x.key === wait.clientEventId)).toHaveLength(1);
  });
  it("other members' events carry their name; the viewer's carry none", () => {
    const r = buildTimeline([ev("departed", "2026-11-03 10:00"), ev("arrived", "2026-11-03 12:00", { userId: "u2", placeName: "Fort" })], { offsetMin: IST, me: "u1", names: { u2: "Anil" } });
    expect(r[0].member).toBeNull(); expect(r[1].member).toBe("Anil");
  });
  it("another member's pause does not stop MY journey", () => {
    const r = deriveJourney([ev("departed", "2026-11-03 10:00"), ev("paused", "2026-11-03 11:00", { userId: "u2" })].filter((x) => x.userId === "u1"));
    expect(r.state).toBe("travelling");
  });
  it("times and dates are India time whatever the phone's zone", () => {
    expect(timeText("2026-11-02T20:37:00Z", IST)).toBe("2:07 AM");
    expect(timeText("2026-11-02T18:30:00Z", IST)).toBe("12:00 AM");
    expect(dateText(Date.parse("2026-11-02T18:30:00Z"), IST)).toBe("Tue 3 Nov");
  });
});

describe("kindForProgress", () => {
  it("maps each saved change to its event", () => {
    expect(kindForProgress({ status: "done" })).toBe("visit_completed");
    expect(kindForProgress({ status: "skipped" })).toBe("visit_skipped");
    expect(kindForProgress({ status: "planned" })).toBe("visit_corrected");
    expect(kindForProgress({ arrived: true })).toBe("arrived");
    expect(kindForProgress({ arrived: false })).toBe("arrival_corrected");
  });
});
