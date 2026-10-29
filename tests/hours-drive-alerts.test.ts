// Slice D: opening-hours alerts while driving, at each coming stop's live arrival time. Hours are read by the real server parser into
// intervals (as GET /api/trips/[id]/hours sends them), then judged in "the browser" exactly as Live mode does. Places are made up.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openIntervals } from "@/lib/server/opening-hours";
import { withEvaluators, type DriveHoursStop } from "@/lib/client/use-hours-drive-alerts";
import { CONFIRMED_LINE, HOURS_ALERT_RULES, clearHoursAlerts, findHoursProblems, hoursAlert, stepHoursAlerts, type HoursMemory } from "@/lib/travel/hours-alerts";

const OFF = 330;
const ist = (date: string, clock: string) => Date.parse(`${date}T${clock}:00+05:30`);
const MON = "2026-11-02";
const MIN = 60_000;

/** The window the route sends for a date (the day before to three days after), for these stops' hours. */
function windowFor(date: string, stops: DriveHoursStop[]) {
  const fromMs = ist(date, "00:00") - 86_400_000, toMs = ist(date, "00:00") + 3 * 86_400_000;
  const out: Record<string, ReturnType<typeof openIntervals>> = {};
  for (const s of stops) if (s.hours) out[s.id] = openIntervals(s.hours, fromMs, toMs, OFF, { lat: 15, lng: 78 });
  return { fromMs, toMs, stops: out as never };
}
const stop = (over: Partial<DriveHoursStop>): DriveHoursStop => ({ id: "s1", name: "Hill Fort", etaMs: null, visitMin: 60, hours: "Mo-Su 09:00-17:00", hoursSource: "user", hoursConfirmed: true, ...over });
const judge = (stops: DriveHoursStop[], nowMs: number, date = MON) => findHoursProblems(withEvaluators(stops, windowFor(date, stops)), nowMs);

describe("what is found, at the live arrival time", () => {
  const now = ist(MON, "15:00");
  it("closed on arrival (confirmed hours): says so, with the next opening, and may buzz", () => {
    const [f] = judge([stop({ etaMs: ist(MON, "17:40") })], now);
    expect(f).toMatchObject({ state: "closed_on_arrival", closesAt: "17:00", confirmed: true });
    const a = hoursAlert(f, "t1", now);
    expect(a.title).toBe("Hill Fort will be closed when you arrive");
    expect(a.body).toMatch(/^You arrive about 5:40 PM; it closes at 5:00 PM\. Next opening: tomorrow at 9:00 AM\. Skip it, or visit another day\./);
    expect(a.body).toContain(CONFIRMED_LINE);
    expect(a.body).toContain("not a promise of entry");
    expect(a).toMatchObject({ kind: "hours", level: 2, silent: true, noPhone: true, duringDrive: true });
  });
  it("the same with UNCONFIRMED map hours: 'may be', labelled 'Unconfirmed (map data)', never a buzz, never worded as a fact", () => {
    const [f] = judge([stop({ etaMs: ist(MON, "17:40"), hoursSource: "osm", hoursConfirmed: false })], now);
    const a = hoursAlert(f, "t1", now);
    expect(a.title).toBe("Hill Fort may be closed when you arrive");
    expect(a.body).toContain("Hours: Unconfirmed (map data), so this is likely, not certain.");
    expect(a.body).not.toContain(CONFIRMED_LINE);
    expect(a.level).toBe(3);
    expect(a.title).not.toMatch(/will be/);
  });
  it("tight: arrives 4:40 PM, closes 5:00 PM, an hour's visit", () => {
    const [f] = judge([stop({ etaMs: ist(MON, "16:35") })], ist(MON, "16:20"));     // 15 min away: a narrow range
    expect(f.state).toBe("closes_soon");
    expect(hoursAlert(f, "t1", ist(MON, "16:20")).body).toMatch(/^You arrive about 4:35 PM and it closes at 5:00 PM: only about 25 min there\. Hurry, or skip it\./);
  });
  it("opens later: arrive 5:20 AM, opens 6:00 AM", () => {
    const [f] = judge([stop({ hours: "Mo-Su 06:00-20:00", etaMs: ist(MON, "05:20") })], ist(MON, "05:05"));
    expect(f.state).toBe("opens_later");
    expect(hoursAlert(f, "t1", ist(MON, "05:05")).body).toMatch(/^It opens at 6:00 AM; you'd wait about 40 min\. You could do another stop first\./);
  });
  it("a short wait before opening isn't worth an alert", () => {
    expect(judge([stop({ hours: "Mo-Su 06:00-20:00", etaMs: ist(MON, "05:53") })], ist(MON, "05:45"))).toEqual([]);
  });
  it("depends on traffic: the arrival range straddles closing time", () => {
    const [f] = judge([stop({ etaMs: ist(MON, "16:55") })], ist(MON, "14:55"));    // 2 h away: about ±12 min
    expect(f.state).toBe("may_close");
    expect(hoursAlert(f, "t1", ist(MON, "14:55")).title).toBe("Hill Fort may close before you get there");
  });
  it("comfortably open: nothing said", () => {
    expect(judge([stop({ etaMs: ist(MON, "11:00") })], ist(MON, "10:30"))).toEqual([]);
  });
  it("closed all day (weekly day off): says so, and when it next opens", () => {
    const [f] = judge([stop({ hours: "Tu-Su 10:00-17:00", etaMs: ist(MON, "11:00") })], ist(MON, "10:30"));
    expect(f.state).toBe("closed_on_arrival");
    expect(hoursAlert(f, "t1", ist(MON, "10:30")).body).toMatch(/by its hours it isn't open that day\. Next opening: tomorrow at 10:00 AM\./);
  });
  it("hours that run past midnight are judged whole", () => {
    expect(judge([stop({ hours: "Mo-Su 18:00-02:00", etaMs: ist("2026-11-03", "00:30") })], ist(MON, "23:50"), MON)).toEqual([]);   // open at 00:30
  });
});

describe("nothing is said without hours we can judge", () => {
  const now = ist(MON, "15:00"), eta = ist(MON, "17:40");
  it("no hours, unreadable hours, or hours that depend on holidays", () => {
    expect(judge([stop({ hours: null, etaMs: eta })], now)).toEqual([]);
    expect(judge([stop({ hours: "open most days, ask the priest", etaMs: eta })], now)).toEqual([]);
    expect(judge([stop({ hours: "Mo-Su 09:00-17:00; PH off", etaMs: eta })], now)).toEqual([]);
  });
  it("offline / the hours couldn't be loaded: nothing at all", () => {
    expect(findHoursProblems(withEvaluators([stop({ etaMs: eta })], null), now)).toEqual([]);
  });
  it("no GPS / no live arrival time: nothing", () => {
    expect(judge([stop({ etaMs: null })], now)).toEqual([]);
  });
  it("only the next few stops, within the next few hours", () => {
    const far = judge([stop({ etaMs: now + (HOURS_ALERT_RULES.horizonMin + 30) * MIN })], now);
    expect(far).toEqual([]);
    const many = ["a", "b", "c", "d"].map((id, i) => stop({ id, name: id, etaMs: ist(MON, "17:40") + i * MIN }));
    expect(judge(many, now).map((f) => f.stopId)).toEqual(["a", "b", "c"]);
  });
});

describe("said once: steady before it is said, quiet updates, taken away when no longer true", () => {
  const T0 = ist(MON, "15:00");
  const f = (etaClock: string, over: Partial<DriveHoursStop> = {}, now = T0) => judge([stop({ etaMs: ist(MON, etaClock), ...over })], now);
  const active = new Set(["s1"]);
  it("a finding is said once, after it held for a minute; repeating the same finding says nothing more", () => {
    const m: HoursMemory = new Map();
    expect(stepHoursAlerts(m, f("17:40"), active, "t1", T0)).toEqual([]);                          // just seen
    const said = stepHoursAlerts(m, f("17:40"), active, "t1", T0 + HOURS_ALERT_RULES.stableMs);
    expect(said.map((a) => a.type)).toEqual(["notify"]);
    expect(stepHoursAlerts(m, f("17:40"), active, "t1", T0 + 2 * MIN)).toEqual([]);
    expect(stepHoursAlerts(m, f("17:43"), active, "t1", T0 + 3 * MIN)).toEqual([]);               // moved less than 5 min: no re-wording
    expect(stepHoursAlerts(m, f("17:50"), active, "t1", T0 + 4 * MIN).map((a) => a.type)).toEqual(["update"]);
  });
  it("a jumpy ETA that flips back and forth within the minute never says anything", () => {
    const m: HoursMemory = new Map();
    for (let i = 0; i < 6; i++) expect(stepHoursAlerts(m, i % 2 ? f("16:55", {}, T0) : f("17:40"), active, "t1", T0 + i * 15_000)).toEqual([]);
  });
  it("tight → closed on CONFIRMED hours escalates once; on unconfirmed hours it is only re-worded", () => {
    for (const [confirmed, type] of [[true, "escalate"], [false, "update"]] as const) {
      const m: HoursMemory = new Map();
      const over = { hoursConfirmed: confirmed, hoursSource: confirmed ? ("user" as const) : ("osm" as const) };
      stepHoursAlerts(m, judge([stop({ etaMs: ist(MON, "16:35"), ...over })], ist(MON, "16:20")), active, "t1", ist(MON, "16:20"));
      stepHoursAlerts(m, judge([stop({ etaMs: ist(MON, "16:35"), ...over })], ist(MON, "16:21")), active, "t1", ist(MON, "16:21"));
      stepHoursAlerts(m, judge([stop({ etaMs: ist(MON, "17:20"), ...over })], ist(MON, "16:22")), active, "t1", ist(MON, "16:22"));
      expect(stepHoursAlerts(m, judge([stop({ etaMs: ist(MON, "17:20"), ...over })], ist(MON, "16:23")), active, "t1", ist(MON, "16:23")).map((a) => a.type)).toEqual([type]);
    }
  });
  it("no longer true (you caught up): taken away after two minutes, not at the first wobble", () => {
    const m: HoursMemory = new Map();
    stepHoursAlerts(m, f("17:40"), active, "t1", T0); stepHoursAlerts(m, f("17:40"), active, "t1", T0 + MIN);
    expect(stepHoursAlerts(m, [], active, "t1", T0 + 2 * MIN)).toEqual([]);
    expect(stepHoursAlerts(m, [], active, "t1", T0 + 4 * MIN)).toEqual([{ type: "withdraw", id: "hours:t1:s1" }]);
  });
  it("the stop is reached or taken off the trip: taken away at once", () => {
    const m: HoursMemory = new Map();
    stepHoursAlerts(m, f("17:40"), active, "t1", T0); stepHoursAlerts(m, f("17:40"), active, "t1", T0 + MIN);
    expect(stepHoursAlerts(m, [], new Set(), "t1", T0 + 2 * MIN)).toEqual([{ type: "withdraw", id: "hours:t1:s1" }]);
  });
  it("the drive ends: everything said goes; nothing unsaid is announced", () => {
    const m: HoursMemory = new Map();
    stepHoursAlerts(m, f("17:40"), active, "t1", T0); stepHoursAlerts(m, f("17:40"), active, "t1", T0 + MIN);
    expect(clearHoursAlerts(m, "t1")).toEqual([{ type: "withdraw", id: "hours:t1:s1" }]);
    expect(m.size).toBe(0);
  });
  it("one alert per stop: the id is the stop's, whatever the finding", () => {
    const a = hoursAlert(f("17:40")[0], "t1", T0), b = hoursAlert(f("16:55", {}, ist(MON, "14:55"))[0], "t1", T0);
    expect(a.id).toBe(b.id);
  });
});

describe("privacy", () => {
  it("the hours request carries the trip and a date only, never a position", () => {
    const src = readFileSync(new URL("../lib/client/use-hours-drive-alerts.ts", import.meta.url), "utf8");
    const fetches = [...src.matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1]);
    expect(fetches).toEqual(["/api/trips/${tripId}/hours?date=${key.split(\"|\")[1]}"]);
  });
});
