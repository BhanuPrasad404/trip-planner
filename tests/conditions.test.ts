// Phase 4: what the real world does to a plan (lib/trip/conditions.ts, and its use in proposals). Pure: weather, hours, sun and roads are
// fakes. The rules: every finding says what it rests on; "couldn't check" is never "all clear"; unconfirmed hours are a doubt, not a
// closure; hill roads after dark are never recommended; nothing is claimed about traffic, closures or fuel stations; a recommendation only
// uses data we have.
import { describe, expect, it } from "vitest";
import { haversineM } from "@/lib/geo";
import { LIMITATIONS, assessPlan, hm, latestDepartureBeforeDark, restAdvice, type ConditionsContext, type PlacedLite, type WeatherState } from "@/lib/trip/conditions";
import { assessCurrentPlan, proposeReplan, type PStop, type ReplanInput } from "@/lib/trip/replan-proposal";

const A = { lat: 17.4, lng: 78.5 }, B = { lat: 16.5, lng: 80.6 };
const place = (o: Partial<PlacedLite> = {}): PlacedLite => ({ id: "p1", name: "Golconda Fort", at: A, day: 1, reachedMin: 10 * 60, visitStartMin: 10 * 60, visitMin: 120, driveKm: 40, driveMin: 60, from: null, ...o });
const ctx = (o: Partial<ConditionsContext> = {}): ConditionsContext => ({ nightDriving: false, dayStartMin: 8 * 60, dayEndMin: 20 * 60, ...o });
const ok = (level: "none" | "watch" | "warning" | "severe", extra: Partial<Extract<WeatherState, { status: "ok" }>> = {}): WeatherState => ({ status: "ok", level, label: level === "none" ? null : "Heavy rain", detail: level === "none" ? null : "about 9 mm in the hour", fetchedAt: Date.UTC(2026, 10, 1, 12, 40), source: "Open-Meteo", ...extra });

describe("weather at the visit", () => {
  it("a warning-level forecast is reported with its source and when it was fetched, and says a forecast can change", () => {
    const { items } = assessPlan([place()], ctx({ weather: () => ok("warning") }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "weather", severity: "warning", basis: "forecast", source: "Open-Meteo, fetched 6:10 PM", stopId: "p1" });
    expect(items[0].title).toBe("Heavy rain forecast at Golconda Fort"); expect(items[0].detail).toMatch(/A forecast can change/);
  });
  it("a watch is noted without a recommendation; nothing to say when the sky is fine", () => {
    expect(assessPlan([place()], ctx({ weather: () => ok("watch") })).items[0]).toMatchObject({ severity: "watch", recommendation: null });
    expect(assessPlan([place()], ctx({ weather: () => ok("none") })).items).toEqual([]);
  });
  it("recommends a clearer hour of the SAME forecast the same day", () => {
    const w = (_: string, _d: number, m: number): WeatherState => ok(m < 15 * 60 ? "severe" : "none");
    const r = assessPlan([place()], ctx({ weather: w })).items[0].recommendation!;
    expect(r).toMatch(/clearer around 3:00 PM: visit then instead/);
  });
  it("else another day of the forecast", () => {
    const w = (_: string, day: number): WeatherState => ok(day === 1 ? "warning" : "none");
    expect(assessPlan([place()], ctx({ weather: w })).items[0].recommendation).toMatch(/next day looks clearer/);
  });
  it("offers an alternative only from the traveller's OWN saved ideas that are indoors; never one that isn't theirs", () => {
    const w = (): WeatherState => ok("warning");
    expect(assessPlan([place()], ctx({ weather: w, ideas: [{ id: "i1", name: "Salar Jung Museum", indoor: true }, { id: "i2", name: "Hussain Sagar", indoor: false }] })).items[0].recommendation).toMatch(/saved ideas is indoors: Salar Jung Museum/);
    expect(assessPlan([place()], ctx({ weather: w, ideas: [{ id: "i2", name: "Hussain Sagar", indoor: false }] })).items[0].recommendation ?? "").not.toMatch(/saved ideas/);
    expect(assessPlan([place()], ctx({ weather: w })).items[0].recommendation ?? "").not.toMatch(/museum|restaurant|temple/i);
  });
  it("a gap in the forecast is never read as an all-clear: no 'clearer hour' is invented", () => {
    const w = (_: string, _d: number, m: number): WeatherState => (m < 14 * 60 ? ok("warning") : { status: "unavailable" });
    expect(assessPlan([place()], ctx({ weather: w })).items[0].recommendation).toBeNull();
  });
  it("unavailable and beyond-the-forecast are reported as 'couldn't check', which is not good weather", () => {
    const r = assessPlan([place({ id: "a", name: "Fort" }), place({ id: "b", name: "Lake" })], ctx({ weather: (id) => (id === "a" ? { status: "unavailable" } : { status: "beyond-forecast" }) }));
    expect(r.items).toEqual([]);
    expect(r.unresolved.join(" ")).toMatch(/weather couldn't be checked for Fort, Lake \(too far ahead for a forecast\).*isn't the same as good weather/);
  });
  it("an indoor stop is not judged by the weather", () => {
    expect(assessPlan([place()], ctx({ weather: () => ok("severe"), outdoor: () => false })).items).toEqual([]);
  });
});

describe("opening hours: confirmed versus a doubt", () => {
  const closed = (confidence: "confirmed" | "unconfirmed", opensAtMin: number | null = null) => () => ({ state: "closed" as const, confidence, opensAtMin, source: confidence === "confirmed" ? "Hours confirmed on your trip" : "OpenStreetMap, not confirmed" });
  it("hours a person confirmed: a real warning, with when it opens", () => {
    const i = assessPlan([place()], ctx({ open: closed("confirmed", 11 * 60) })).items[0];
    expect(i).toMatchObject({ kind: "hours", severity: "warning", basis: "confirmed-hours" });
    expect(i.title).toMatch(/is closed when you'd be there/); expect(i.recommendation).toBe("Arrive after 11:00 AM.");
  });
  it("hours only read from map data: a DOUBT ('may be closed'), never stated as a closure", () => {
    const i = assessPlan([place()], ctx({ open: closed("unconfirmed") })).items[0];
    expect(i).toMatchObject({ severity: "watch", basis: "map-hours" });
    expect(i.title).toMatch(/may be closed/); expect(i.detail).toMatch(/nobody has confirmed these hours.*a doubt, not a fact/); expect(i.source).toMatch(/not confirmed/);
  });
  it("unknown hours are listed as 'couldn't be confirmed' and never as closed", () => {
    const r = assessPlan([place()], ctx({ open: () => ({ state: "unknown" }) }));
    expect(r.items).toEqual([]); expect(r.unresolved.join(" ")).toMatch(/couldn't be confirmed for Golconda Fort.*not treated as closed/);
  });
  it("open is quiet", () => { expect(assessPlan([place()], ctx({ open: () => ({ state: "open" }) })).items).toEqual([]); });
});

describe("daylight, night, and hill roads", () => {
  const SUNSET = 18 * 60 + 5;
  it("after dark without night driving: a watch, with the latest time to set off for daylight", () => {
    const i = assessPlan([place({ reachedMin: 19 * 60, visitStartMin: 19 * 60, driveMin: 120, from: B })], ctx({ sunset: () => SUNSET })).items[0];
    expect(i).toMatchObject({ kind: "daylight", severity: "watch", basis: "sun-calculation" });
    expect(i.detail).toMatch(/sunset there is about 6:05 PM.*asked not to drive after dark/); expect(i.recommendation).toMatch(/set off by 4:05 PM/);
  });
  it("a HILL road after dark is a warning that no setting turns into advice: even with night driving on", () => {
    const i = assessPlan([place({ reachedMin: 18 * 60 + 30, visitStartMin: 18 * 60 + 30, driveMin: 120, from: B })], ctx({ sunset: () => SUNSET, hill: () => true, nightDriving: true })).items[0];
    expect(i).toMatchObject({ kind: "night", severity: "warning" });
    expect(i.title).toBe("A hill road after dark to Golconda Fort");
    expect(i.detail).toMatch(/We don't suggest driving hill roads at night, even if night driving is on/);
    expect(i.recommendation).toMatch(/set off by 3:05 PM.*split the drive/); // an hour less light on a hill road
  });
  it("a hill road reached before the earlier (hill) limit is fine, the same arrival on a flat road is also fine", () => {
    expect(assessPlan([place({ reachedMin: 16 * 60, visitStartMin: 16 * 60, from: B })], ctx({ sunset: () => SUNSET, hill: () => true })).items).toEqual([]);
    expect(assessPlan([place({ reachedMin: 17 * 60 + 30, visitStartMin: 17 * 60 + 30, from: B })], ctx({ sunset: () => SUNSET, hill: () => false })).items).toEqual([]);
  });
  it("a night arrival (visited in the morning) says so, that road conditions at night can't be seen, and to line up a place to rest", () => {
    const i = assessPlan([place({ reachedMin: 24 * 60 + 30, visitStartMin: 24 * 60 + 8 * 60, day: 2, from: B })], ctx({ sunset: () => SUNSET, nightDriving: true, dayEndMin: 20 * 60 })).items[0];
    expect(i).toMatchObject({ kind: "night", severity: "info" });
    expect(i.detail).toMatch(/12:30 AM.*same journey.*morning.*we can't see road conditions/); expect(i.recommendation).toMatch(/somewhere to rest/);
  });
  it("without sun data nothing about daylight is claimed", () => {
    expect(assessPlan([place({ reachedMin: 22 * 60, visitStartMin: 22 * 60, from: B })], ctx()).items).toEqual([]);
  });
  it("latestDepartureBeforeDark: sunset minus the drive (and an hour more on hills), null when even the first minute of the day is too late", () => {
    expect(latestDepartureBeforeDark(1085, 120, false, 480)).toBe(965);
    expect(latestDepartureBeforeDark(1085, 120, true, 480)).toBe(905);
    expect(latestDepartureBeforeDark(1085, 700, false, 480)).toBeNull();
  });
});

describe("fuel range", () => {
  const day = (km: number, d = 1) => place({ day: d, driveKm: km });
  it("more than the fuel you said you have covers: a warning; and it says it doesn't know where fuel stations are", () => {
    const i = assessPlan([day(200)], ctx({ vehicle: { rangeKm: 350, fuelPct: 40 } })).items[0];
    expect(i).toMatchObject({ kind: "range", severity: "warning", basis: "distance-estimate" });
    expect(i.detail).toMatch(/About 200 km.*about 119 km is safe.*don't know which fuel stations/); expect(i.recommendation).toMatch(/town/);
  });
  it("with no fuel level said, only a long day against the full range is called out, as a watch", () => {
    expect(assessPlan([day(300)], ctx({ vehicle: { rangeKm: 350, fuelPct: null } })).items[0]).toMatchObject({ severity: "watch", title: "Day 1 is a long drive for your vehicle" });
    expect(assessPlan([day(200)], ctx({ vehicle: { rangeKm: 350, fuelPct: null } })).items).toEqual([]);
  });
  it("the fuel level applies to the first day only (we can't know about later fill-ups, and don't pretend to)", () => {
    const r = assessPlan([day(100, 1), day(100, 2)], ctx({ vehicle: { rangeKm: 350, fuelPct: 20 } }));
    expect(r.items.map((i) => i.day)).toEqual([1]);
  });
  it("never names a fuel station", () => {
    const text = JSON.stringify(assessPlan([day(200)], ctx({ vehicle: { rangeKm: 350, fuelPct: 10 } })));
    expect(text).not.toMatch(/petrol pump|HP |Indian Oil|Shell|Reliance/i);
  });
  it("no vehicle information, no range finding", () => { expect(assessPlan([day(900)], ctx()).items).toEqual([]); });
});

describe("what nobody can tell, and rest", () => {
  it("states that traffic, road closures and fuel stations are unknown", () => {
    expect(LIMITATIONS.join(" ")).toMatch(/Live traffic and road closures aren't available/);
    expect(LIMITATIONS.join(" ")).toMatch(/can't tell whether a fuel station is open/);
    expect(LIMITATIONS.join(" ")).toMatch(/covers only the next 16 days/);
  });
  it("rest: a suggestion after 2 h by day, sooner at night; it never says anyone is tired or unfit", () => {
    expect(restAdvice({ drivingMin: 119, nowMin: 14 * 60 })).toBeNull();
    expect(restAdvice({ drivingMin: 120, nowMin: 14 * 60 })).toMatchObject({ level: 3, title: "A break soon" });
    expect(restAdvice({ drivingMin: 180, nowMin: 14 * 60 })).toMatchObject({ level: 2, title: "Time for a break" });
    expect(restAdvice({ drivingMin: 90, nowMin: 23 * 60 })).toMatchObject({ level: 3 });
    expect(restAdvice({ drivingMin: 150, nowMin: 23 * 60 })).toMatchObject({ level: 2 });
    for (const a of [restAdvice({ drivingMin: 200, nowMin: 3 * 60 }), restAdvice({ drivingMin: 130, nowMin: 14 * 60 })]) expect(JSON.stringify(a)).not.toMatch(/tired|drowsy|unfit|fatigue|asleep|unsafe to drive/i);
  });
  it("after 2 AM it suggests sleeping over pushing on, as advice not a diagnosis", () => {
    expect(restAdvice({ drivingMin: 200, nowMin: 3 * 60 })!.body).toMatch(/sleeping before carrying on is better than pushing through/);
    expect(restAdvice({ drivingMin: 200, nowMin: 14 * 60 })!.body).not.toMatch(/sleeping/);
  });
  it("bad input says nothing", () => {
    expect(restAdvice({ drivingMin: null, nowMin: 600 })).toBeNull(); expect(restAdvice({ drivingMin: Number.NaN, nowMin: 600 })).toBeNull(); expect(restAdvice({ drivingMin: -5, nowMin: 600 })).toBeNull();
  });
  it("hm formats across midnight", () => { expect(hm(24 * 60 + 30)).toBe("12:30 AM"); expect(hm(13 * 60 + 5)).toBe("1:05 PM"); });
});

// ── In the proposal and for the plan as it stands ──
const drive = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => { const km = (haversineM(a, b) / 1000) * 1.25; return { min: (km / 55) * 60, km, estimated: false }; };
const stop = (id: string, name: string, p: { lat: number; lng: number }, day: number, order: number, o: Partial<PStop> = {}): PStop => ({ id, name, ...p, day, order, arrivalTime: "10:00", status: "planned", visitMin: 90, priority: "normal", ...o });
const input = (stops: PStop[], o: Partial<ReplanInput> = {}): ReplanInput => ({ stops, numDays: 3, nowDay: 1, nowMin: 8 * 60, origin: A, journey: "travelling", drive, prefs: { dayStartMin: 480, dayEndMin: 1200, nightDriving: false, bufferMin: 10 }, startDate: "2026-11-01", notStarted: false, ...o });

describe("in a proposal", () => {
  it("the proposal carries what the real world does to it, and the limits", () => {
    const p = proposeReplan(input([stop("a", "Fort", { lat: 17.4, lng: 78.6 }, 1, 1)], { weather: () => ok("warning") }), "keep-end");
    expect(p.conditions.map((c) => c.kind)).toEqual(["weather"]);
    expect(p.limitations).toBe(LIMITATIONS);
  });
  it("a HILL road at night is never proposed, even with night driving on: the stop is moved to daylight instead", () => {
    const far = stop("h", "Hill station", { lat: 16.0, lng: 80.0 }, 1, 1);
    const flat = proposeReplan(input([far], { nowMin: 15 * 60, prefs: { dayStartMin: 480, dayEndMin: 1200, nightDriving: true, bufferMin: 10 } }), "leave-now");
    const hill = proposeReplan(input([far], { nowMin: 15 * 60, hill: () => true, prefs: { dayStartMin: 480, dayEndMin: 1200, nightDriving: true, bufferMin: 10 } }), "leave-now");
    expect(flat.night.arrivals).toBe(1);               // allowed on a flat road
    expect(hill.night.arrivals).toBe(0);               // refused on a hill road
    expect(hill.days[0].day).toBe(2);
    expect(hill.changes[0].reason).toMatch(/hill road.*We don't suggest that/);
  });
  it("a closure read from unconfirmed hours is a doubt: the stop stays where it is, flagged 'maybe closed'", () => {
    const o = () => ({ state: "closed" as const, confidence: "unconfirmed" as const });
    const p = proposeReplan(input([stop("a", "Museum", { lat: 17.4, lng: 78.6 }, 1, 1)], { open: o }), "keep-end");
    expect(p.days[0].day).toBe(1); expect(p.days[0].stops[0].flags).toContain("maybe_closed");
    expect(p.conditions[0]).toMatchObject({ kind: "hours", severity: "watch" });
  });
  it("the same closure from CONFIRMED hours moves the stop to a day it is open", () => {
    const o = (_id: string, day: number) => ({ state: day === 1 ? ("closed" as const) : ("open" as const), confidence: "confirmed" as const });
    const p = proposeReplan(input([stop("a", "Museum", { lat: 17.4, lng: 78.6 }, 1, 1)], { open: o }), "keep-end");
    expect(p.days[0].day).toBe(2);
  });
});

describe("the plan as it stands", () => {
  it("is checked at the times the plan has, changes nothing, and lists what could not be checked", () => {
    const stops = [stop("a", "Fort", { lat: 17.4, lng: 78.6 }, 1, 1, { arrivalTime: "10:00" }), stop("b", "Lake", { lat: 17.5, lng: 78.7 }, 2, 1, { arrivalTime: null })];
    const before = JSON.stringify(stops);
    const r = assessCurrentPlan(input(stops, { weather: (id) => (id === "a" ? ok("severe") : { status: "unavailable" }) }));
    expect(r.items.map((i) => i.stopId)).toEqual(["a"]);
    expect(r.unresolved.join(" ")).toMatch(/1 stop has no planned time yet, so it was not checked/);
    expect(r.limitations).toBe(LIMITATIONS);
    expect(JSON.stringify(stops)).toBe(before);
  });
  it("says the weather was not checked when there is no forecast source (a trip with no dates)", () => {
    expect(assessCurrentPlan(input([stop("a", "Fort", { lat: 17.4, lng: 78.6 }, 1, 1)])).unresolved).toContain("The weather was not checked.");
  });
  it("finished stops are not assessed", () => {
    expect(assessCurrentPlan(input([stop("a", "Fort", A, 1, 1, { status: "done" })], { weather: () => ok("severe") })).items).toEqual([]);
  });
});
