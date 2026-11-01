// Phase 3: the replan PROPOSAL (lib/trip/replan-proposal.ts). Pure: roads, hours and sun are fakes. The guarantees: nothing is dropped
// silently, done/skipped/Ideas are untouched, a must or a confirmed booking is never proposed for removal, "not feasible" is a real answer,
// uncertainty is stated, and the same input gives the same proposal.
import { describe, expect, it } from "vitest";
import { haversineM } from "@/lib/geo";
import { planStaleness, proposeReplan, scheduleSignature, strategiesFor, type Commitment, type PStop, type Priority, type Proposal, type ReplanInput, type Strategy } from "@/lib/trip/replan-proposal";

const HYD = { lat: 17.385, lng: 78.4867, name: "Hyderabad" };
const VJA = { lat: 16.5062, lng: 80.648 }, KDT = { lat: 16.5128, lng: 80.6055 }, VSKP = { lat: 17.6868, lng: 83.2185 }, KAIL = { lat: 17.7425, lng: 83.3428 }, ARAKU = { lat: 18.3273, lng: 82.8775 };
// Road minutes: straight line x 1.25 at 55 km/h, like a real road would roughly be.
const drive = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => { const km = (haversineM(a, b) / 1000) * 1.25; return { min: (km / 55) * 60, km, estimated: false }; };
const stop = (id: string, name: string, p: { lat: number; lng: number }, day: number | null, order: number | null, o: Partial<PStop> = {}): PStop => ({ id, name, ...p, day, order, arrivalTime: null, status: "planned", visitMin: 90, priority: "normal", ...o });
const TRIP: PStop[] = [
  stop("vja", "Vijayawada", VJA, 1, 1, { visitMin: 60, arrivalTime: "14:00" }),
  stop("kdt", "Kanaka Durga Temple", KDT, 2, 1, { visitMin: 90, arrivalTime: "09:30", priority: "high" }),
  stop("vskp", "Visakhapatnam", VSKP, 3, 1, { visitMin: 60, arrivalTime: "15:00" }),
  stop("kail", "Kailasagiri", KAIL, 4, 1, { visitMin: 120, arrivalTime: "10:00", priority: "optional" }),
  stop("araku", "Araku Valley", ARAKU, 5, 1, { visitMin: 180, arrivalTime: "11:00", priority: "must" }),
];
const input = (o: Partial<ReplanInput> = {}): ReplanInput => ({
  stops: TRIP, numDays: 5, nowDay: 1, nowMin: 18 * 60 + 30, origin: HYD, journey: "awaiting-departure", drive,
  prefs: { dayStartMin: 8 * 60, dayEndMin: 20 * 60, nightDriving: false, bufferMin: 10 }, startDate: "2026-11-01", notStarted: true, ...o,
});
const ids = (p: Proposal) => p.days.flatMap((d) => d.stops.map((s) => s.id));
const accounted = (p: Proposal, stops = TRIP) => new Set([...ids(p), ...p.removals.map((r) => r.id), ...p.notPlaced.map((n) => n.id)]).size === stops.filter((s) => s.status === "planned" && s.day !== null).length;
const ALL: Strategy[] = ["leave-now", "tomorrow", "shift", "keep-end", "extend", "compress", "keep-important", "custom"];

describe("late departure: 6:30 PM, 5-day trip, not left yet", () => {
  it("leaving now without night driving: Vijayawada is ~5.5 h away, so it can't be reached before the day ends; nothing is forced", () => {
    const p = proposeReplan(input(), "leave-now");
    const vja = p.days.flatMap((d) => d.stops).find((s) => s.id === "vja");
    expect(vja?.day).toBe(2); // pushed to tomorrow, honestly
    expect(p.changes.find((c) => c.id === "vja")).toMatchObject({ kind: "moved", from: { day: 1 }, to: { day: 2 } });
    expect(p.changes.find((c) => c.id === "vja")!.reason).toMatch(/moved from Day 1 to Day 2/i);
    expect(p.night).toEqual({ arrivals: 0, drives: 0 });
  });
  it("with the 5 days the trip has, everything may not fit: that is said, and the must is never dropped", () => {
    const p = proposeReplan(input(), "leave-now");
    expect(accounted(p)).toBe(true);
    if (!p.feasible) expect(p.summary).toMatch(/doesn't work/i);
    expect(p.removals.every((r) => r.id !== "araku")).toBe(true);
  });
  it("with night driving allowed: reached at ~midnight, it is a night ARRIVAL: the visit is the next morning, and it is flagged", () => {
    const p = proposeReplan(input({ prefs: { dayStartMin: 480, dayEndMin: 1200, nightDriving: true, bufferMin: 10 } }), "leave-now");
    const vja = p.days.flatMap((d) => d.stops).find((s) => s.id === "vja")!;
    expect(vja.flags).toEqual(expect.arrayContaining(["overnight_arrival", "night_drive"]));
    expect(vja.day).toBe(2);                 // visited on the morning of the next day
    expect(vja.arriveMin).toBe(8 * 60);      // at the start of that day, not at 2 AM
    expect(p.night.arrivals).toBe(1);
    expect(p.summary).toMatch(/arrival.*at night.*rest and visit in the morning/i);
    expect(p.atRisk.some((r) => r.id === "vja" && /night/i.test(r.why))).toBe(true);
  });
  it("night driving is capped: an arrival after 2 AM is not proposed even when night driving is on", () => {
    const far = stop("far", "Far away", { lat: 8.5, lng: 77 }, 1, 1);
    const p = proposeReplan(input({ stops: [far], prefs: { dayStartMin: 480, dayEndMin: 1200, nightDriving: true, bufferMin: 10 } }), "leave-now");
    expect(p.notPlaced.map((n) => n.id)).toContain("far");
    expect(p.feasible).toBe(false);
  });
  it("'start tomorrow morning' starts the stops on tomorrow's first slot", () => {
    const p = proposeReplan(input(), "tomorrow");
    expect(p.days[0].day).toBe(2);
    expect(p.days[0].stops[0].arriveMin).toBeGreaterThanOrEqual(8 * 60);
  });
  it("shifting a trip that has not started moves its DATES and keeps every stop on its day number", () => {
    const p = proposeReplan(input(), "shift");
    expect(p.dates).toMatchObject({ startDate: "2026-11-02", numDays: 5, startShiftDays: 1, extraDays: 0 });
    expect(p.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
    expect(p.changes.every((c) => c.kind === "unchanged")).toBe(true);
    expect(p.changes[0].reason).toMatch(/starts 1 day later/);
    expect(p.summary).toMatch(/start 1 day later \(2026-11-02\) and keep its length/);
  });
});

describe("a missed day", () => {
  // Day 1 and 2 passed with nothing done; it is the morning of Day 4 and Hyderabad is still where the traveller is.
  const behind = input({ nowDay: 4, nowMin: 9 * 60, journey: "awaiting-departure" });
  it("is noticed from what really happened: Day 1's stop is still to do and today is Day 2", () => {
    expect(planStaleness({ stops: TRIP, journey: "awaiting-departure", nowDay: 2, nowMin: 9 * 60, numDays: 5 })).toMatchObject({ kind: "missed-day", missedDays: 1, firstDay: 1 });
    expect(planStaleness({ stops: TRIP, journey: "awaiting-departure", nowDay: 4, nowMin: 9 * 60, numDays: 5 })).toMatchObject({ kind: "missed-day", missedDays: 3 });
  });
  it("Day 1's stop is carried forward, not marked done, not discarded", () => {
    const p = proposeReplan(behind, "extend");
    expect(ids(p)).toContain("vja");
    expect(TRIP.find((s) => s.id === "vja")!.status).toBe("planned");
    expect(accounted(p)).toBe(true);
    expect(p.feasible).toBe(true);
    expect(p.dates.extraDays).toBeGreaterThan(0);
    expect(p.summary).toMatch(/run \d+ days? longer/);
  });
  it("keeping the original end date: the optional stop is the one proposed for removal (to Ideas, never deleted); the must stays", () => {
    // Five long visits close together, two days left: room for four. The LATEST optional one is proposed for removal; the must stays.
    const near = (i: number) => ({ lat: 17.4 + i * 0.001, lng: 78.5 });
    const five: PStop[] = [["s1", "must"], ["s2", "optional"], ["s3", "normal"], ["s4", "optional"], ["s5", "high"]].map(([id, priority], i) => stop(id, `Stop ${i + 1}`, near(i), 1 + Math.floor(i / 3), (i % 3) + 1, { visitMin: 300, priority: priority as Priority, arrivalTime: null }));
    const p = proposeReplan(input({ stops: five, numDays: 2, nowDay: 1, nowMin: 8 * 60, origin: near(0), journey: "travelling", notStarted: false }), "keep-end");
    expect(p.removals.map((r) => r.id)).toEqual(["s4"]);
    expect(p.removals[0].reason).toMatch(/optional/);
    expect(p.changes.find((c) => c.id === "s4")).toMatchObject({ kind: "proposed-removal", to: { day: null } });
    expect(p.changes.find((c) => c.id === "s4")!.reason).toMatch(/go back to your ideas, not be deleted/);
    expect(ids(p)).toEqual(expect.arrayContaining(["s1", "s2", "s3", "s5"]));
    expect(p.feasible).toBe(true);
    expect(p.dates.numDays).toBe(2);
    expect(accounted(p, five)).toBe(true);
  });
  it("from Day 4 the must (Araku Valley) cannot fit in the two days left: not feasible, named, and the optional stop is still proposed for removal rather than the must", () => {
    const p = proposeReplan(behind, "keep-end");
    expect(p.feasible).toBe(false);
    expect(p.notPlaced.map((n) => n.id)).toContain("araku");
    expect(p.removals.map((r) => r.id)).toContain("kail");
    expect(p.removals.map((r) => r.id)).not.toContain("araku");
    expect(accounted(p)).toBe(true);
  });
  it("when even that is not enough the answer is 'not feasible', naming what doesn't fit; a must is never dropped to make it work", () => {
    const tight = input({ nowDay: 5, nowMin: 9 * 60, stops: TRIP.map((s) => ({ ...s, priority: "must" as Priority })) });
    const p = proposeReplan(tight, "keep-end");
    expect(p.feasible).toBe(false);
    expect(p.removals).toEqual([]);
    expect(p.notPlaced.length).toBeGreaterThan(0);
    expect(p.summary).toMatch(/doesn't work/);
    expect(accounted(p, tight.stops)).toBe(true);
  });
  it("'keep the important' drops the lowest priority first and says why", () => {
    const p = proposeReplan(input({ nowDay: 4, nowMin: 9 * 60 }), "keep-important");
    expect(accounted(p)).toBe(true);
    for (const r of p.removals) expect(["normal", "optional", "high"]).toContain(TRIP.find((s) => s.id === r.id)!.priority);
    expect(p.removals.every((r) => r.id !== "araku")).toBe(true);
  });
  it("squeezing in with shorter visits shortens them (never below 60%) and flags it", () => {
    const p = proposeReplan(behind, "compress");
    const placed = p.days.flatMap((d) => d.stops);
    for (const s of placed) { expect(s.flags).toContain("shortened_visit"); const orig = TRIP.find((t) => t.id === s.id)!.visitMin; expect(s.visitMin).toBeGreaterThanOrEqual(Math.round(orig * 0.6) - 1); expect(s.visitMin).toBeLessThan(orig); }
  });
});

describe("what a proposal never touches", () => {
  const mixed: PStop[] = [
    stop("done1", "Done already", VJA, 1, 1, { status: "done" }),
    stop("skip1", "Skipped already", KDT, 1, 2, { status: "skipped" }),
    stop("idea1", "Only an idea", VSKP, null, null),
    stop("open1", "Still to do", VSKP, 2, 1),
  ];
  for (const strategy of ["leave-now", "tomorrow", "keep-end", "extend", "compress", "keep-important", "shift"] as Strategy[]) {
    it(`${strategy}: finished stops and Ideas are untouched, and only the open stop is in the proposal`, () => {
      const p = proposeReplan(input({ stops: mixed, nowDay: 2, nowMin: 600, origin: VJA, journey: "travelling", notStarted: false }), strategy);
      expect(ids(p).concat(p.removals.map((r) => r.id), p.notPlaced.map((n) => n.id))).toEqual(["open1"]);
      expect(p.changes.map((c) => c.id)).toEqual(["open1"]);
    });
  }
  it("a shift under way keeps the dates (the trip gets longer), because history stays where it happened", () => {
    const p = proposeReplan(input({ stops: mixed, nowDay: 3, nowMin: 600, origin: VJA, journey: "travelling", notStarted: false }), "shift");
    expect(p.dates.startShiftDays).toBe(0);
    expect(p.dates.startDate).toBe("2026-11-01");
  });
});

describe("every stop is accounted for, for every strategy", () => {
  for (const strategy of ALL) {
    for (const now of [{ nowDay: 1, nowMin: 400 }, { nowDay: 1, nowMin: 18 * 60 + 30 }, { nowDay: 3, nowMin: 600 }, { nowDay: 9, nowMin: 600 }]) {
      it(`${strategy} at day ${now.nowDay} ${now.nowMin} min: placed + removed + not placed = all open stops, and no stop twice`, () => {
        const p = proposeReplan(input({ ...now }), strategy);
        const all = [...ids(p), ...p.removals.map((r) => r.id), ...p.notPlaced.map((n) => n.id)];
        expect(new Set(all).size).toBe(all.length);
        expect(accounted(p)).toBe(true);
        expect(p.removals.every((r) => TRIP.find((s) => s.id === r.id)!.priority !== "must")).toBe(true);
      });
    }
  }
  it("is deterministic: the same situation gives exactly the same proposal", () => {
    expect(proposeReplan(input(), "keep-end")).toEqual(proposeReplan(input(), "keep-end"));
  });
});

describe("bookings are protected", () => {
  const hotel: Commitment = { kind: "fixed", day: 3, confirmed: true, label: "Hotel Sai Residency", latestArriveMin: 22 * 60 };
  const booked = TRIP.map((s) => (s.id === "vskp" ? { ...s, commitment: hotel } : s));
  it("shifting the trip by a day would move a confirmed booking: the proposal says so and is NOT feasible", () => {
    const p = proposeReplan(input({ stops: booked }), "shift");
    expect(p.bookingConflicts).toEqual([expect.objectContaining({ id: "vskp", confirmed: true })]);
    expect(p.bookingConflicts[0].why).toMatch(/fixed for Day 3.*Day 4/);
    expect(p.feasible).toBe(false);
    expect(p.summary).toMatch(/break a booking|booking/);
  });
  it("keeping the end date holds a booked stop on its day and never proposes removing it", () => {
    const p = proposeReplan(input({ stops: booked.map((s) => (s.id === "vskp" ? { ...s, priority: "optional" as Priority } : s)), nowDay: 2, nowMin: 9 * 60 }), "keep-important");
    expect(p.removals.map((r) => r.id)).not.toContain("vskp");
    const v = p.days.flatMap((d) => d.stops).find((s) => s.id === "vskp");
    expect(v?.day).toBe(3);
  });
  it("a booked day is waited for: the days between stay empty rather than the booking being moved", () => {
    const p = proposeReplan(input({ stops: [stop("h", "Hotel stay", VJA, 1, 1, { commitment: { kind: "fixed", day: 4, confirmed: true, label: "Hotel" } })], nowDay: 1, nowMin: 600 }), "keep-end");
    expect(p.days.map((d) => d.day)).toEqual([4]);
    expect(p.bookingConflicts).toEqual([]);
  });
  it("arriving after a booked latest time is reported (contact them), not silently allowed", () => {
    const late: Commitment = { kind: "time-sensitive", day: 1, confirmed: true, label: "Temple darshan slot", latestArriveMin: 9 * 60 };
    const p = proposeReplan(input({ stops: [stop("t", "Temple", VJA, 1, 1, { commitment: late })], nowDay: 1, nowMin: 7 * 60, origin: HYD }), "leave-now");
    expect(p.bookingConflicts[0].why).toMatch(/needs you there by 9:00 AM.*Contact them/);
    expect(p.feasible).toBe(false);
  });
  it("an unconfirmed saved plan is a warning, not a block: a place the traveller only typed is not treated as a reservation", () => {
    const soft = { ...hotel, confirmed: false };
    const p = proposeReplan(input({ stops: TRIP.map((s) => (s.id === "vskp" ? { ...s, commitment: soft } : s)) }), "shift");
    expect(p.bookingConflicts[0].confirmed).toBe(false);
    expect(p.feasible).toBe(true);
  });
});

describe("opening hours and uncertainty", () => {
  const stopsOne = [stop("a", "Museum", VJA, 1, 1, { visitMin: 60 })];
  it("closed all day: tried the next day; closed until later: wait for it; unknown: never a closure", () => {
    const closedToday = proposeReplan(input({ stops: stopsOne, nowDay: 1, nowMin: 400, origin: VJA, open: (_id, day) => (day === 1 ? { state: "closed" } : { state: "open" }) }), "keep-end");
    expect(closedToday.days[0].day).toBe(2);
    const opensLate = proposeReplan(input({ stops: stopsOne, nowDay: 1, nowMin: 400, origin: VJA, open: () => ({ state: "closed", opensAtMin: 11 * 60 }) }), "keep-end");
    expect(opensLate.days[0].stops[0]).toMatchObject({ arriveMin: 11 * 60, flags: expect.arrayContaining(["waited_for_opening"]) });
    const unknown = proposeReplan(input({ stops: stopsOne, nowDay: 1, nowMin: 400, origin: VJA, open: () => ({ state: "unknown" }) }), "keep-end");
    expect(unknown.days[0].day).toBe(1);
    expect(unknown.days[0].stops[0].flags).toContain("hours_unknown");
    expect(unknown.unresolved.join(" ")).toMatch(/couldn't be confirmed.*not treated as closed/);
  });
  it("estimated roads are stated; hours or sunset not checked are stated; nothing is guaranteed", () => {
    const p = proposeReplan(input({ drive: (a, b) => ({ ...drive(a, b), estimated: true }) }), "extend");
    const u = p.unresolved.join(" ");
    expect(u).toMatch(/estimates.*straight-line/); expect(u).toMatch(/Opening hours were not checked/); expect(u).toMatch(/Sunset was not checked/); expect(u).toMatch(/not guarantees/);
  });
  it("a stop closed all week is reported, not forced onto a closed day", () => {
    const p = proposeReplan(input({ stops: stopsOne, nowDay: 1, nowMin: 400, origin: VJA, open: () => ({ state: "closed" }) }), "keep-end");
    expect(p.feasible).toBe(false);
    expect(p.notPlaced[0].reason).toMatch(/closed/);
  });
  it("after dark with night driving off defers the stop (sunset known), with the reason", () => {
    const p = proposeReplan(input({ stops: [stop("a", "Fort", VJA, 1, 1)], nowDay: 1, nowMin: 13 * 60, origin: HYD, sunset: () => 17 * 60 + 45 }), "keep-end");
    expect(p.changes[0].reason).toMatch(/after dark/i);
  });
});

describe("the traveller changes their mind: modifying a proposal", () => {
  it("keeping a stop protects it from being proposed for removal, and the proposal may then not be feasible", () => {
    const base = input({ nowDay: 5, nowMin: 9 * 60 });
    const p = proposeReplan({ ...base, keepIds: ["kail", "kdt"] }, "keep-end");
    expect(p.removals.map((r) => r.id)).not.toContain("kail");
    expect(accounted(p)).toBe(true);
  });
  it("asking to leave a stop out lists it as removed (to Ideas), never as deleted", () => {
    const p = proposeReplan(input({ dropIds: ["kail"] }), "extend");
    expect(p.removals).toEqual([{ id: "kail", name: "Kailasagiri", reason: "You asked to leave it out." }]);
    expect(ids(p)).not.toContain("kail");
  });
  it("a must can't be removed even when the traveller asks to in a request: it stays in the plan", () => {
    const p = proposeReplan(input({ dropIds: ["araku"] }), "extend");
    expect(ids(p)).toContain("araku");
    expect(p.removals.map((r) => r.id)).not.toContain("araku");
  });
  it("custom: the traveller's own days are honoured and timed, and reported if they can't work", () => {
    const p = proposeReplan(input({ nowDay: 1, nowMin: 400, pinDays: { araku: 2, vja: 3 } }), "custom");
    const day = (id: string) => p.days.flatMap((d) => d.stops).find((s) => s.id === id)?.day;
    expect(day("araku")).toBe(2); expect(day("vja")).toBe(3);
  });
});

describe("when is the plan out of date (asked once, never starts anything)", () => {
  const base = { stops: TRIP, numDays: 5, drivesFirstLegMin: 330 };
  it("late departure: the planned leaving time (arrival minus the first drive) passed by an hour and the traveller has not left", () => {
    // planned arrival 14:00 minus 5.5 h drive = 08:30 planned leaving
    expect(planStaleness({ ...base, journey: "awaiting-departure", nowDay: 1, nowMin: 9 * 60 + 29 })).toBeNull();
    expect(planStaleness({ ...base, journey: "awaiting-departure", nowDay: 1, nowMin: 9 * 60 + 30 })).toMatchObject({ kind: "late-departure", minutesLate: 60, firstStop: "Vijayawada" });
    expect(planStaleness({ ...base, journey: "awaiting-departure", nowDay: 1, nowMin: 18 * 60 + 30 })).toMatchObject({ kind: "late-departure", minutesLate: 600 });
  });
  it("passing the planned time does not start the journey and does not by itself say anything once they are travelling on time", () => {
    expect(planStaleness({ ...base, journey: "travelling", nowDay: 1, nowMin: 14 * 60 + 30 })).toBeNull();
  });
  it("running behind: 90+ minutes past the next stop's planned time while travelling", () => {
    expect(planStaleness({ ...base, journey: "travelling", nowDay: 1, nowMin: 15 * 60 + 29 })).toBeNull();
    expect(planStaleness({ ...base, journey: "travelling", nowDay: 1, nowMin: 15 * 60 + 30 })).toMatchObject({ kind: "running-behind", minutesBehind: 90 });
  });
  it("outside the trip's days, or with nothing left to do, there is nothing to say", () => {
    expect(planStaleness({ ...base, journey: "awaiting-departure", nowDay: null, nowMin: 600 })).toBeNull();
    expect(planStaleness({ ...base, stops: TRIP.map((s) => ({ ...s, status: "done" as const })), journey: "travelling", nowDay: 2, nowMin: 600 })).toBeNull();
  });
  it("a stop with no planned time can't be late", () => {
    expect(planStaleness({ ...base, stops: TRIP.map((s) => ({ ...s, arrivalTime: null })), journey: "awaiting-departure", nowDay: 1, nowMin: 20 * 60 })).toBeNull();
  });
  it("which options to show for each situation", () => {
    expect(strategiesFor("late-departure", { notStarted: true, hasOptional: true })).toEqual(["leave-now", "tomorrow", "shift", "keep-end"]);
    expect(strategiesFor("late-departure", { notStarted: false, hasOptional: true })).toEqual(["leave-now", "tomorrow", "keep-end"]);
    expect(strategiesFor("missed-day", { notStarted: true, hasOptional: true })).toEqual(["shift", "keep-end", "extend", "compress", "keep-important"]);
    expect(strategiesFor("running-behind", { notStarted: false, hasOptional: false })).toEqual(["keep-end", "extend", "keep-important"]);
  });
});

describe("scheduleSignature", () => {
  const rows = [{ id: "a", day: 1, order: 1, status: "planned" }, { id: "b", day: 2, order: 1, status: "planned" }];
  it("changes when a stop moves, is marked done, or is added, and not with the order the rows arrive in", () => {
    const sig = scheduleSignature(rows);
    expect(scheduleSignature([...rows].reverse())).toBe(sig);
    expect(scheduleSignature([{ ...rows[0], day: 2 }, rows[1]])).not.toBe(sig);
    expect(scheduleSignature([{ ...rows[0], status: "done" }, rows[1]])).not.toBe(sig);
    expect(scheduleSignature([...rows, { id: "c", day: 3, order: 1, status: "planned" }])).not.toBe(sig);
  });
});
