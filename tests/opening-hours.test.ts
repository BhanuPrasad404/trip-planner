// Opening hours end to end: the server parser (real opening_hours library), the browser's interval judge, matching a stop to map data,
// the planner actually receiving and using the hours, and the rule that the LGPL library never reaches browser code.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOLIDAY_REASON, hoursStatusAt, openIntervals, validateHours } from "@/lib/server/opening-hours";
import { evaluatorFromIntervals, mergeIntervals, type OpenInterval } from "@/lib/travel/hours-intervals";
import { matchHours, type HoursCandidate } from "@/lib/travel/hours-match";
import { checkDeparture } from "@/lib/travel/feasibility";
import { buildPlan } from "@/lib/trip-builder/plan";
import { hoursOf } from "@/lib/server/builder";
import { localToUtcMs } from "@/lib/travel/clock";
import { makeInput } from "./builder-fixtures";

const IST = 330;
const at = (date: string, clock: string) => localToUtcMs(date, clock, IST)!; // India wall time → UTC ms
const HYD = { lat: 17.38, lng: 78.47 };

describe("validateHours (server, real parser)", () => {
  it("accepts real opening_hours syntax, including what the old basic reader could not read", () => {
    for (const v of ["Mo-Su 09:00-17:30", "Tu-Su 09:00-17:00; Mo off", "Mo-Sa 10:00-13:00,14:00-18:00", "Mo-Su 18:00-02:00", "24/7", "Apr-Sep 10:00-17:00; Oct-Mar 09:00-18:00", "sunrise-sunset"]) {
      expect(validateHours(v, HYD), v).toMatchObject({ ok: true, value: v });
    }
  });
  it("refuses text it can't read, with a reason, instead of guessing", () => {
    const r = validateHours("open whenever the priest is around");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toMatch(/couldn't read these opening hours/); expect(r.reason).not.toMatch(/pull request/i); }
  });
  it("refuses empty and over-long text", () => {
    expect(validateHours("   ").ok).toBe(false);
    expect(validateHours(`Mo-Su 09:00-18:00${" ".repeat(10)}${"x".repeat(260)}`).ok).toBe(false);
  });
  it("passes on the parser's own warnings instead of hiding them", () => {
    const r = validateHours("Mo-Fr 9am-5pm");
    expect(r.ok && r.warnings.length > 0).toBe(true);
  });
  it("holiday rules are valid but flagged: there is no Indian holiday calendar to check them against", () => {
    expect(validateHours("Mo-Su 09:00-18:00; PH off")).toMatchObject({ ok: true, warnings: [HOLIDAY_REASON] });
  });
});

describe("hoursStatusAt (server, destination wall time)", () => {
  // 2026-10-14 is a Wednesday.
  it("open / closed / closing time in India time", () => {
    expect(hoursStatusAt("Mo-Su 09:00-17:30", at("2026-10-14", "10:00"), IST, HYD)).toEqual({ state: "open", at: "17:30" });
    expect(hoursStatusAt("Mo-Su 09:00-17:30", at("2026-10-14", "08:00"), IST, HYD)).toEqual({ state: "closed", at: "09:00" });
    expect(hoursStatusAt("Mo-Su 09:00-17:30", at("2026-10-14", "18:00"), IST, HYD)).toEqual({ state: "closed" }); // opens only tomorrow
  });
  it("closed days, split days and overnight hours", () => {
    expect(hoursStatusAt("Mo-Su 09:00-18:00; We off", at("2026-10-14", "10:00"), IST).state).toBe("closed");
    expect(hoursStatusAt("Mo-Sa 10:00-13:00,14:00-18:00", at("2026-10-14", "13:30"), IST)).toEqual({ state: "closed", at: "14:00" });
    expect(hoursStatusAt("Mo-Su 18:00-02:00", at("2026-10-15", "01:00"), IST)).toEqual({ state: "open", at: "02:00" }); // after midnight
    expect(hoursStatusAt("Mo-Su 18:00-02:00", at("2026-10-14", "23:00"), IST)).toEqual({ state: "open", at: "02:00" });
  });
  it("seasons (months) are read", () => {
    const v = "Apr-Sep 10:00-17:00; Oct-Mar 09:00-18:00";
    expect(hoursStatusAt(v, at("2026-10-14", "09:30"), IST)).toEqual({ state: "open", at: "18:00" });
    expect(hoursStatusAt(v, at("2026-05-14", "09:30"), IST)).toEqual({ state: "closed", at: "10:00" });
  });
  it("24-hour places have no closing time (no false 'closes at 00:00')", () => {
    expect(hoursStatusAt("24/7", at("2026-10-14", "23:50"), IST)).toEqual({ state: "open" });
    expect(hoursStatusAt("Mo-Su 00:00-24:00", at("2026-10-14", "23:50"), IST)).toEqual({ state: "open" });
  });
  it("unknown stays unknown: holiday rules, open-ended times, comments, unreadable text, bad instants", () => {
    expect(hoursStatusAt("Mo-Su 09:00-18:00; PH off", at("2026-10-14", "10:00"), IST).state).toBe("unknown");
    expect(hoursStatusAt("Mo-Su 09:00+", at("2026-10-14", "20:00"), IST).state).toBe("unknown");
    expect(hoursStatusAt('Mo-Su 09:00-18:00 "last entry 17:30"', at("2026-10-14", "10:00"), IST).state).toBe("unknown");
    expect(hoursStatusAt("garbage", at("2026-10-14", "10:00"), IST).state).toBe("unknown");
    expect(hoursStatusAt("24/7", Number.NaN, IST).state).toBe("unknown");
  });
  it("uses the destination's offset, not the server's clock: the same instant is open in India and closed half a world away", () => {
    const t = at("2026-10-14", "10:00");
    expect(hoursStatusAt("Mo-Su 09:00-11:00", t, IST).state).toBe("open");
    expect(hoursStatusAt("Mo-Su 09:00-11:00", t, -300).state).toBe("closed"); // 23:30 the previous evening at UTC-5
  });
});

describe("browser judge from server intervals (no library in the browser)", () => {
  const cases = ["Mo-Su 09:00-17:30", "Tu-Su 09:00-17:00; Mo off", "Mo-Sa 10:00-13:00,14:00-18:00", "Mo-Su 18:00-02:00", "24/7", "Apr-Sep 10:00-17:00; Oct-Mar 09:00-18:00", "Mo-Su 09:00-18:00; We off"];
  it("agrees with the server parser at every 15 minutes across four days (state, and the time it gives)", () => {
    const from = at("2026-10-13", "00:00"), to = at("2026-10-17", "00:00");
    for (const v of cases) {
      const w = openIntervals(v, from, to, IST, HYD);
      expect(w.status, v).toBe("ok");
      if (w.status !== "ok") continue;
      const judge = evaluatorFromIntervals({ fromMs: from, toMs: to, intervals: w.intervals }, IST);
      // Stay a day away from the window's end, where the browser rightly stops claiming a closing time it wasn't sent.
      for (let t = from; t < to - 24 * 3_600_000; t += 15 * 60_000) {
        const a = judge(t), b = hoursStatusAt(v, t, IST, HYD);
        expect(a.state, `${v} @ ${new Date(t).toISOString()}`).toBe(b.state);
        expect(a.at, `${v} @ ${new Date(t).toISOString()}`).toBe(b.at);
      }
    }
  });
  it("outside the window the server sent, the answer is unknown (never extended)", () => {
    const from = at("2026-10-13", "00:00"), to = at("2026-10-14", "00:00");
    const w = openIntervals("24/7", from, to, IST);
    const judge = evaluatorFromIntervals({ fromMs: from, toMs: to, intervals: w.status === "ok" ? w.intervals : [] }, IST);
    expect(judge(at("2026-10-14", "10:00")).state).toBe("unknown");
    expect(judge(at("2026-10-12", "10:00")).state).toBe("unknown");
  });
  it("holiday rules come back as 'unverifiable' with the reason", () => {
    expect(openIntervals("Mo-Su 09:00-18:00; PH off", 0, 1, IST)).toEqual({ status: "unverifiable", reason: HOLIDAY_REASON });
  });
  it("back-to-back intervals merge; unknown stretches are kept separate", () => {
    const iv: OpenInterval[] = [[10, 20, false], [20, 30, false], [30, 40, true]];
    expect(mergeIntervals(iv)).toEqual([[10, 30, false], [30, 40, true]]);
  });
  it("feeds the departure check: seasonal hours give a real answer instead of 'unverified'", () => {
    const v = "Apr-Sep 10:00-17:00; Oct-Mar 09:00-18:00";
    const from = at("2026-10-13", "00:00"), to = at("2026-10-17", "00:00");
    const w = openIntervals(v, from, to, IST);
    if (w.status !== "ok") throw new Error("expected intervals");
    const evaluate = evaluatorFromIntervals({ fromMs: from, toMs: to, intervals: w.intervals }, IST);
    const r = checkDeparture({ departureMs: at("2026-10-14", "16:00"), stops: [{ id: "a", name: "Fort", driveMin: 60, visitMin: 120, hours: v, hoursSource: "user", hoursConfirmed: true, evaluate }] });
    expect(r.verdicts[0].state).toBe("closes_soon"); // arrive ~17:00, closes 18:00, 2 h visit
  });
});

describe("unconfirmed map data is softened, confirmed hours are not", () => {
  const run = (o: object) => checkDeparture({ departureMs: at("2026-10-14", "21:00"), stops: [{ id: "a", name: "Fort", driveMin: 60, visitMin: 60, hours: "Mo-Su 09:00-18:00", ...o }] }).verdicts[0];
  it("traveller-entered or confirmed: a likely closure is a risk", () => {
    expect(run({ hoursSource: "user", hoursConfirmed: true }).severity).toBe("risk");
    expect(run({ hoursSource: "osm", hoursConfirmed: true }).severity).toBe("risk");
  });
  it("map data nobody confirmed: the same closure is a warning, and says why", () => {
    const v = run({ hoursSource: "osm", hoursConfirmed: false });
    expect(v.state).toBe("closed_on_arrival"); expect(v.severity).toBe("warn"); expect(v.detail).toMatch(/haven't been confirmed/);
  });
});

describe("matching a stop to map data", () => {
  const stop = { name: "Bhongir Fort", lat: 17.5135, lng: 78.8885 };
  const c = (o: Partial<HoursCandidate>): HoursCandidate => ({ ref: "osm/way/1", name: "Bhongir Fort", lat: 17.5137, lng: 78.8887, hours: "Mo-Su 09:00-17:30", ...o });
  it("a similarly named feature nearby with hours is a match", () => {
    expect(matchHours(stop, [c({})])).toMatchObject({ kind: "match", candidate: { ref: "osm/way/1" } });
  });
  it("no hours, no name, too far, or a different name: no match (never a guess)", () => {
    expect(matchHours(stop, [c({ hours: null })]).kind).toBe("none");
    expect(matchHours(stop, [c({ name: null })]).kind).toBe("none");
    expect(matchHours(stop, [c({ lat: 17.53 })]).kind).toBe("none"); // ~1.8 km
    expect(matchHours(stop, [c({ name: "Hotel Sai Residency" })]).kind).toBe("none");
  });
  it("two plausible features with DIFFERENT hours: ambiguous, nothing is saved", () => {
    expect(matchHours(stop, [c({}), c({ ref: "osm/node/2", name: "Bhongir Fort Museum", hours: "Tu-Su 10:00-17:00" })]).kind).toBe("ambiguous");
  });
  it("is deterministic when several features agree", () => {
    const a = matchHours(stop, [c({ ref: "osm/node/9" }), c({ ref: "osm/node/3" })]);
    const b = matchHours(stop, [c({ ref: "osm/node/3" }), c({ ref: "osm/node/9" })]);
    expect(a).toEqual(b);
  });
});

describe("the planner receives and uses the stored hours", () => {
  // 2026-10-20 (the fixtures' first day) is a Tuesday; "closed on Tuesdays in Oct-Mar" is something only the full parser can read.
  const HOURS = "Oct-Mar Mo,We-Su 09:00-18:00; Apr-Sep Mo-Su 09:00-18:00";
  it("hoursOf turns a stop row into planner hours (unreadable text becomes unknown, not open)", () => {
    expect(hoursOf({ opening_hours: HOURS, hours_source: "traveller", lat: 17, lng: 78 })).toEqual({ hours: HOURS, hoursSource: "traveller", hoursConfirmed: true });
    expect(hoursOf({ opening_hours: HOURS, hours_source: "map_data", hours_confirmed_at: null })).toMatchObject({ hoursSource: "map_data", hoursConfirmed: false });
    expect(hoursOf({ opening_hours: "garbage hours", hours_source: "traveller" })).toEqual({ hours: null, hoursSource: null, hoursConfirmed: false });
    expect(hoursOf({ opening_hours: null, hours_source: null })).toEqual({ hours: null, hoursSource: null, hoursConfirmed: false });
  });
  const plan = (o: object) => {
    const input = { ...makeInput([{ name: "Fort", at: [19.0761, 72.8778], category: "fort", hours: HOURS }], { numDays: 1 }), evalHours: hoursStatusAt };
    Object.assign(input.places[0], o);
    return buildPlan(input, "balanced");
  };
  it("with the server parser, a closed day is caught (the old path left every stop's hours unknown)", () => {
    const p = plan({ hoursSource: "traveller", hoursConfirmed: true });
    expect(p.days[0].stops[0].flags).toContain("closed_at_arrival");
    expect(p.warnings.find((w) => w.code === "closed_at_arrival")).toMatchObject({ severity: "risk" });
  });
  it("unconfirmed map data: the same closure is a labelled warning, not the highest severity", () => {
    const w = plan({ hoursSource: "map_data", hoursConfirmed: false }).warnings.find((x) => x.code === "closed_at_arrival");
    expect(w).toMatchObject({ severity: "warn" }); expect(w!.message).toMatch(/map data \(OpenStreetMap\), not yet confirmed/);
  });
  it("without the server parser the same text is 'unknown', never assumed open or closed", () => {
    const input = makeInput([{ name: "Fort", at: [19.0761, 72.8778], category: "fort", hours: HOURS }], { numDays: 1 });
    expect(buildPlan(input, "balanced").days[0].stops[0].flags).toContain("hours_unknown");
  });
});

describe("licence boundary: the LGPL opening_hours library never reaches browser code", () => {
  const root = join(__dirname, "..");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  const all = ["app", "components", "lib"].flatMap((d) => files(join(root, d)));
  it("only lib/server/opening-hours.ts imports the library", () => {
    const importers = all.filter((f) => /from\s+["']opening_hours["']/.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1).replace(/\\/g, "/"));
    expect(importers).toEqual(["lib/server/opening-hours.ts"]);
  });
  it("no client component or browser module imports the server hours module", () => {
    const client = all.filter((f) => { const s = readFileSync(f, "utf8"); return /^["']use client["']/m.test(s) || f.includes(join("lib", "client")) || f.includes(join("lib", "travel")); });
    const offenders = client.filter((f) => /@\/lib\/server\/(opening-hours|builder)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
