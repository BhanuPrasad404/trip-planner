import { describe, expect, it } from "vitest";
import { buildIntel } from "@/lib/intel/engine";
import type { IntelInput, StopInput } from "@/lib/intel/types";
import type { PoiKind, PoiRecord } from "@/lib/poi/types";

// Saturday 10 Oct 2026, 10:00 India time. The road runs due east along lat 17.0 from lng 80.0 to 81.0 (~106 km).
const at = (h: number, m = 0) => Date.UTC(2026, 9, 10, h, m) - 330 * 60_000;
const LINE: [number, number][] = [[80.0, 17.0], [80.5, 17.0], [81.0, 17.0]];
const KM_TO_LNG = 1 / 106.3; // ≈ degrees of longitude per km at this latitude

/** A place `km` along the road and `sideM` metres to the side. */
const poi = (kind: PoiKind, name: string, km: number, sideM = 0, tags: Record<string, string> = {}): PoiRecord => ({
  source: "osm", source_id: `${kind}/${name}`, kind, name, lat: 17 + sideM / 111_000, lng: 80 + km * KM_TO_LNG, tags, fetched_at: "2026-10-01T00:00:00Z",
});

const stop = (id: string, km: number, extra: Partial<StopInput> = {}): StopInput => ({
  id, name: `Stop ${id}`, lat: 17, lng: 80 + km * KM_TO_LNG, plannedArrival: null, visitMin: 60, value: 1, valueNote: null, outdoor: true, ...extra,
});

function scenario(over: Partial<IntelInput> = {}): IntelInput {
  return {
    nowMs: at(10), utcOffsetMin: 330, position: { lat: 17, lng: 80 }, heading: 90, speedKmh: null,
    route: { line: LINE, legs: [{ km: 106, minutes: 130 }] },
    stops: [stop("end", 106)], pois: [], prefs: { tripType: "friends", vehicleRangeKm: 350 },
    weather: [], dayEndMin: 20 * 60, coverageComplete: true, boost: {}, comparePlan: false, ...over,
  };
}
const best = (r: ReturnType<typeof buildIntel>, kind: PoiKind) => r.aheadByKind[kind]?.[0];

describe("ranking along the route", () => {
  it("drops places behind you, too far from the road, or closed when you'd arrive", () => {
    const r = buildIntel(scenario({
      position: { lat: 17, lng: 80 + 20 * KM_TO_LNG },
      pois: [poi("fuel", "Behind", 5), poi("fuel", "Far off road", 40, 6000), poi("fuel", "Closed", 40, 0, { opening_hours: "Mo-Su 00:00-01:00" }), poi("fuel", "Good", 40)],
    }));
    expect(r.aheadByKind.fuel?.map((p) => p.name)).toEqual(["Good"]);
  });

  it("does not call something behind the start of the road 'ahead'", () => {
    const r = buildIntel(scenario({ pois: [poi("fuel", "Behind start", -2.5), poi("fuel", "Side street at start", 0.2, 400)] }));
    expect(r.aheadByKind.fuel?.map((p) => p.name)).toEqual(["Side street at start"]);
  });

  it("prefers a place right on the road over the same distance with a detour", () => {
    const r = buildIntel(scenario({ pois: [poi("food", "On road", 30), poi("food", "Detour", 30, 2500)] }));
    const names = [...(r.aheadByKind.food ?? [])].sort((a, b) => b.score - a.score).map((p) => p.name);
    expect(names).toEqual(["On road", "Detour"]);
    expect(r.aheadByKind.food!.find((p) => p.name === "Detour")!.detourMin).toBeGreaterThanOrEqual(8);
  });

  it("prefers open-for-sure over unknown hours", () => {
    const r = buildIntel(scenario({ pois: [poi("pharmacy", "Open", 20, 0, { opening_hours: "24/7" }), poi("pharmacy", "Unknown", 20)] }));
    const o = r.aheadByKind.pharmacy!;
    expect(o.find((p) => p.name === "Open")!.score).toBeGreaterThan(o.find((p) => p.name === "Unknown")!.score);
    expect(o.find((p) => p.name === "Unknown")!.reasons.join(" ")).toMatch(/not listed/);
  });

  it("explains itself in plain words", () => {
    const [p] = buildIntel(scenario({ pois: [poi("fuel", "HP Pump", 12, 0, { brand: "HP", opening_hours: "24/7" })] })).aheadByKind.fuel!;
    expect(p.reasons.join(" | ")).toMatch(/12 km ahead, right on your road/);
    expect(p.arriveClock).toMatch(/^\d\d:\d\d$/);
    expect(p.reasons.join(" ")).toMatch(/HP/);
  });

  it("personalises by trip type", () => {
    const pois = [poi("restroom", "Toilets", 20), poi("repair", "Garage", 20)];
    const family = buildIntel(scenario({ pois, prefs: { tripType: "family", vehicleRangeKm: 350 } }));
    const biker = buildIntel(scenario({ pois, prefs: { tripType: "biker", vehicleRangeKm: 350 } }));
    expect(best(family, "restroom")!.score).toBeGreaterThan(best(biker, "restroom")!.score);
    expect(best(biker, "repair")!.score).toBeGreaterThan(best(family, "repair")!.score);
  });

  it("rain at the time you'd arrive lowers a viewpoint and lifts a cafe", () => {
    const rainy = [{ lat: 17, lng: 80.2, hours: [10, 11, 12].map((h) => ({ time: new Date(at(h)).toISOString(), tempC: 24, precipMm: 3, precipProb: 90 })) }];
    const pois = [poi("viewpoint", "Point", 25), poi("cafe", "Chai", 25)];
    const dry = buildIntel(scenario({ pois }));
    const wet = buildIntel(scenario({ pois, weather: rainy }));
    expect(best(wet, "viewpoint")!.score).toBeLessThan(best(dry, "viewpoint")!.score);
    expect(best(wet, "cafe")!.score).toBeGreaterThanOrEqual(best(dry, "cafe")!.score);
    expect(best(wet, "viewpoint")!.reasons.join(" ")).toMatch(/Rain/);
  });

  it("fresh community updates raise a place and say why", () => {
    const p = poi("food", "Dhaba", 20);
    const plain = buildIntel(scenario({ pois: [p] }));
    const boosted = buildIntel(scenario({ pois: [p], boost: { "osm|food/Dhaba": 1 } }));
    expect(best(boosted, "food")!.score).toBeGreaterThan(best(plain, "food")!.score);
    expect(best(boosted, "food")!.reasons.join(" ")).toMatch(/Fresh updates/);
  });

  it("returns at most 8 per kind, in the order you'll pass them", () => {
    const r = buildIntel(scenario({ pois: Array.from({ length: 20 }, (_, i) => poi("food", `F${i}`, 3 + i * 4)) }));
    const list = r.aheadByKind.food!;
    expect(list).toHaveLength(8);
    expect([...list].sort((a, b) => a.alongM - b.alongM).map((p) => p.name)).toEqual(list.map((p) => p.name));
  });
});

describe("Smart Stops", () => {
  it("warns about fuel when a long stretch follows the next station (range 120 km)", () => {
    const r = buildIntel(scenario({ prefs: { tripType: "friends", vehicleRangeKm: 120 }, pois: [poi("fuel", "Only pump", 15)] }));
    const f = r.smartStops.find((s) => s.type === "fuel")!;
    expect(f.urgency).toBe("now");
    expect(f.reason).toMatch(/no station on your route/);
    expect(f.options[0].name).toBe("Only pump");
    expect(r.advice[0].kind).toBe("fuel"); // fuel outranks everything else
  });

  it("stays quiet about fuel when stations are plentiful", () => {
    const pois = Array.from({ length: 6 }, (_, i) => poi("fuel", `P${i}`, 10 + i * 18));
    expect(buildIntel(scenario({ prefs: { tripType: "friends", vehicleRangeKm: 120 }, pois })).smartStops.find((s) => s.type === "fuel")).toBeUndefined();
  });

  it("says 'no fuel found' only when the whole corridor has been mapped", () => {
    const longRoute = { prefs: { tripType: "friends" as const, vehicleRangeKm: 200 } };
    expect(buildIntel(scenario({ ...longRoute, coverageComplete: true })).smartStops.some((s) => s.title.includes("No fuel found"))).toBe(true);
    const partial = buildIntel(scenario({ ...longRoute, coverageComplete: false }));
    expect(partial.smartStops.some((s) => s.title.includes("No fuel found"))).toBe(false);
    expect(partial.notes.join(" ")).toMatch(/Still mapping/);
  });

  it("suggests lunch when you'd pass a good place inside the lunch window", () => {
    const r = buildIntel(scenario({ nowMs: at(13, 50), pois: [poi("food", "Biryani House", 5), poi("food", "Too late", 60)] })); // 60 km on = ~15:10, after lunch ends at 14:30
    const meal = r.smartStops.find((s) => s.type === "meal")!;
    expect(meal.title).toMatch(/Lunch/);
    expect(meal.options.map((o) => o.name)).toContain("Biryani House");
    expect(meal.options.map((o) => o.name)).not.toContain("Too late");
  });

  it("does not push meals at 3 pm", () => {
    expect(buildIntel(scenario({ nowMs: at(15, 0), pois: [poi("food", "Dhaba", 10)] })).smartStops.find((s) => s.type === "meal")).toBeUndefined();
  });

  it("lines up a stay when you'll arrive late", () => {
    const r = buildIntel(scenario({ nowMs: at(17, 30), pois: [poi("stay", "Hotel Near End", 100)] })); // 130 drive + 60 visit → ~20:40... plus
    const stay = r.smartStops.find((s) => s.type === "stay");
    // finish is 17:30 + 190 min = 20:40 → not yet "late" (<21:00)
    expect(stay).toBeUndefined();
    const later = buildIntel(scenario({ nowMs: at(18, 30), pois: [poi("stay", "Hotel Near End", 100)] })); // finish ≈ 21:40
    expect(later.smartStops.find((s) => s.type === "stay")!.options[0].name).toBe("Hotel Near End");
  });

  it("offers a sunset viewpoint you can still reach in good light", () => {
    const r = buildIntel(scenario({ nowMs: at(15, 30), pois: [poi("viewpoint", "Sunset Point", 60, 400)] })); // arrive ≈ 16:45, sunset ≈ 17:52
    const s = r.smartStops.find((x) => x.type === "sunset")!;
    expect(s.title).toMatch(/Catch the sunset at 17:5\d/);
    expect(s.options[0].name).toBe("Sunset Point");
  });

  it("suggests a break around two hours of driving", () => {
    const r = buildIntel(scenario({ route: { line: LINE, legs: [{ km: 106, minutes: 160 }] }, pois: [poi("restroom", "Rest stop", 70)] }));
    expect(r.smartStops.find((s) => s.type === "break")).toBeDefined();
  });

  it("points out worthwhile sights close to the road when there is slack, but not ones already planned", () => {
    const pois = [poi("sight", "Old Fort", 10, 300), poi("sight", "Stop end", 105, 0)];
    const r = buildIntel(scenario({ nowMs: at(10), pois }));
    const d = r.smartStops.find((s) => s.type === "detour")!;
    expect(d.options.map((o) => o.name)).toContain("Old Fort");
    expect(d.options.map((o) => o.name)).not.toContain("Stop end"); // already on the itinerary
  });
});

describe("advice: adapting the plan", () => {
  it("tells you when you're behind plan and offers a re-plan", () => {
    const r = buildIntel(scenario({ comparePlan: true, stops: [stop("end", 106, { plannedArrival: "11:00" })] })); // ETA 12:10
    const a = r.advice.find((x) => x.kind === "behind")!;
    expect(a.title).toMatch(/70 min behind/);
    expect(a.action).toEqual({ type: "replan" });
    expect(r.stopEtas[0]).toMatchObject({ etaClock: "12:10", delayMin: 70 });
  });

  it("does not compare with the plan when the day is not today", () => {
    expect(buildIntel(scenario({ comparePlan: false, stops: [stop("end", 106, { plannedArrival: "11:00" })] })).advice.some((x) => x.kind === "behind")).toBe(false);
  });

  it("warns you won't finish in time and suggests dropping the stops that cost the most for the least", () => {
    const r = buildIntel(scenario({
      nowMs: at(16, 30),
      route: { line: LINE, legs: [{ km: 53, minutes: 65 }, { km: 53, minutes: 65 }] },
      stops: [stop("a", 53, { value: 1.8, valueNote: "Great timing and 3 upvotes." }), stop("b", 106, { value: 0.2, valueNote: "Only 1 vote and poor timing." })],
    }));
    const late = r.advice.find((x) => x.kind === "late")!;
    expect(late.title).toMatch(/finish around 20:/);
    expect(late.action).toEqual({ type: "replan" });
    const skip = r.advice.find((x) => x.kind === "skip")!;
    expect(skip.action).toEqual({ type: "skip", stopId: "b" }); // the weak one
    expect(skip.detail).toMatch(/Only 1 vote/);
    expect(r.advice.map((a) => a.priority)).toEqual([...r.advice.map((a) => a.priority)].sort((x, y) => y - x));
  });

  it("never suggests skipping the stop you're about to reach", () => {
    const r = buildIntel(scenario({
      nowMs: at(17, 0),
      route: { line: LINE, legs: [{ km: 3, minutes: 5 }, { km: 103, minutes: 130 }] },
      stops: [stop("near", 3, { value: 0 }), stop("far", 106, { value: 1 })],
    }));
    expect(r.advice.filter((x) => x.kind === "skip").map((x) => x.action)).not.toContainEqual({ type: "skip", stopId: "near" });
  });

  it("flags rain at an outdoor stop at the time you'll arrive, and points to a dry alternative", () => {
    const hrs = (prob: number) => [10, 11, 12, 13, 14, 15].map((h) => ({ time: new Date(at(h)).toISOString(), tempC: 26, precipMm: prob > 50 ? 3 : 0, precipProb: prob }));
    const r = buildIntel(scenario({
      route: { line: LINE, legs: [{ km: 53, minutes: 65 }, { km: 53, minutes: 65 }] },
      stops: [stop("a", 53), stop("b", 106)],
      weather: [{ lat: 17, lng: 80.5, hours: hrs(10) }, { lat: 17, lng: 81.0, hours: hrs(90) }],
    }));
    const rain = r.advice.find((x) => x.kind === "weather" && x.id === "rain-b")!;
    expect(rain.title).toMatch(/Rain likely at Stop b around \d\d:\d\d \(90%\)/);
    expect(rain.detail).toMatch(/Stop a looks dry/);
    expect(r.advice.find((x) => x.id === "rain-a")).toBeUndefined();
  });

  it("does not warn about rain at indoor stops", () => {
    const r = buildIntel(scenario({ stops: [stop("end", 106, { outdoor: false })], weather: [{ lat: 17, lng: 81, hours: [12, 13].map((h) => ({ time: new Date(at(h)).toISOString(), tempC: 24, precipMm: 5, precipProb: 95 })) }] }));
    expect(r.advice.some((x) => x.kind === "weather")).toBe(false);
  });

  it("warns when an outdoor stop would be reached after sunset", () => {
    const r = buildIntel(scenario({ nowMs: at(16, 30) })); // arrive ≈ 18:40, sunset ≈ 17:52
    expect(r.advice.find((x) => x.kind === "daylight")!.detail).toMatch(/sunset is 17:5\d/);
  });

  it("copes with no stops at all", () => {
    const r = buildIntel(scenario({ stops: [], route: { line: LINE, legs: [] } }));
    expect(r.finishClock).toBeNull();
    expect(r.stopEtas).toEqual([]);
    expect(r.advice.filter((a) => ["late", "behind", "skip"].includes(a.kind))).toEqual([]);
  });

  it("reports sunrise/sunset, remaining distance and a finish time", () => {
    const r = buildIntel(scenario());
    expect(r.sun!.sunset).toMatch(/^17:5\d$/);
    expect(r.remainingKm).toBeGreaterThan(105);
    expect(r.finishClock).toBe("13:10"); // 10:00 + 130 drive + 60 visit
  });

  it("explains an empty database honestly", () => {
    expect(buildIntel(scenario({ pois: [], coverageComplete: false })).notes.join(" ")).toMatch(/Still mapping/);
    expect(buildIntel(scenario({ pois: [], coverageComplete: true })).notes.join(" ")).toMatch(/No places are stored/);
  });
});

describe("only claims what has been mapped", () => {
  it("does not say 'no fuel found' about road beyond the part we mapped", () => {
    const r = buildIntel(scenario({ prefs: { tripType: "friends", vehicleRangeKm: 300 }, coverageComplete: true, mappedKm: 30 }));
    expect(r.smartStops.some((s) => s.title.includes("No fuel found"))).toBe(false); // 30 km of 106 mapped < 0.35 × 300
  });
});

describe("community helpers", () => {
  it("boosts places with recent reports nearby, ignores old or far ones, and finds real photos", async () => {
    const { communityBoost, communityPhotoPath } = await import("@/lib/intel/community");
    const p = poi("food", "Dhaba", 20);
    const now = Date.parse("2026-10-10T00:00:00Z");
    const day = (n: number) => new Date(now - n * 86_400_000).toISOString();
    const near = { lat: p.lat, lng: p.lng };
    const b = communityBoost([p], [{ ...near, photo_path: "a.jpg", created_at: day(2) }, { ...near, photo_path: null, created_at: day(30) }, { lat: p.lat + 1, lng: p.lng, photo_path: "far.jpg", created_at: day(1) }, { ...near, photo_path: null, created_at: day(90) }], now);
    expect(b["osm|food/Dhaba"]).toBeCloseTo(0.7, 2); // 0.5 (≤7 days) + 0.2 (≤60 days); far and 90-day-old ignored
    expect(communityBoost([p], [], now)).toEqual({});
    expect(communityPhotoPath(near, [{ ...near, photo_path: "old.jpg", created_at: day(10) }, { ...near, photo_path: "new.jpg", created_at: day(1) }])).toBe("new.jpg");
    expect(communityPhotoPath(near, [{ lat: p.lat + 1, lng: p.lng, photo_path: "far.jpg", created_at: day(1) }])).toBeNull();
  });
});

describe("Travel Radar, break-from-real-driving, opportunities, health", () => {
  it("radar lists one best pick per kind, soonest first, with detour and timely notes", () => {
    const r = buildIntel(scenario({ nowMs: at(15, 30), pois: [poi("fuel", "HP", 12), poi("food", "Dhaba", 20, 300), poi("viewpoint", "Sunset Point", 60, 200), poi("cafe", "Chai Stop", 5)] }));
    expect(new Set(r.radar.map((x) => x.name))).toEqual(new Set(["Chai Stop", "HP", "Dhaba", "Sunset Point"]));
    expect(r.radar.map((x) => x.etaMin)).toEqual([...r.radar.map((x) => x.etaMin)].sort((a, b) => a - b));
    expect(new Set(r.radar.map((x) => x.kind)).size).toBe(r.radar.length); // one per kind
    const view = r.radar.find((x) => x.kind === "viewpoint")!;
    expect(view.note).toMatch(/Sunset \d+ min after you arrive/);
    expect(r.radar.find((x) => x.kind === "food")!.detourMin).toBeGreaterThan(0);
  });

  it("radar never shows more than six, and skips weak or far places", () => {
    const kinds = ["fuel", "food", "cafe", "restroom", "pharmacy", "stay", "viewpoint", "sight"] as const;
    const r = buildIntel(scenario({ pois: kinds.map((k, i) => poi(k, `P${i}`, 5 + i * 3)) }));
    expect(r.radar.length).toBeLessThanOrEqual(6);
    expect(buildIntel(scenario({ pois: [poi("food", "Far", 105)] })).radar).toEqual([]); // ~2 h away: not on the radar
  });

  it("suggests a break from how long you've REALLY been driving, in plain words", () => {
    const r = buildIntel(scenario({ drivingMin: 123, pois: [poi("cafe", "Roadside Cafe", 9), poi("fuel", "Pump", 40)] }));
    const b = r.smartStops.find((s) => s.type === "break")!;
    expect(b.reason).toMatch(/You've been driving for 2h 03m\. Roadside Cafe is \d+ min ahead/);
    expect(b.urgency).toBe("soon");
    expect(buildIntel(scenario({ drivingMin: 160, pois: [poi("cafe", "Roadside Cafe", 9)] })).smartStops.find((s) => s.type === "break")!.urgency).toBe("now");
    expect(buildIntel(scenario({ drivingMin: 30, pois: [poi("cafe", "Roadside Cafe", 9)] })).smartStops.find((s) => s.type === "break")).toBeUndefined();
  });

  it("calls out a 'better opportunity' with the reasons (clear weather, sunset), and offers Go There", () => {
    const clear = [{ lat: 17, lng: 80.2, hours: [14, 15, 16, 17].map((h) => ({ time: new Date(at(h)).toISOString(), tempC: 27, precipMm: 0, precipProb: 5 })) }];
    const r = buildIntel(scenario({ nowMs: at(15, 0), weather: clear, route: { line: LINE, legs: [{ km: 106, minutes: 130 }] }, pois: [poi("sight", "Hill Temple", 12, 500)] }));
    const o = r.advice.find((a) => a.id === "detour")!;
    expect(o.title).toBe("Better opportunity found");
    expect(o.detail).toMatch(/Hill Temple is \d+ min ahead with clear weather/);
    expect(o.detail).toMatch(/adds a \d+-minute detour and fits your schedule/);
    expect(o.action).toEqual({ type: "insert_stop", key: "osm|sight/Hill Temple" });
    expect(o.why!.length).toBeGreaterThan(1);
  });

  it("every important piece of advice can say WHY, with numbers", () => {
    const r = buildIntel(scenario({ nowMs: at(16, 30), route: { line: LINE, legs: [{ km: 53, minutes: 65 }, { km: 53, minutes: 65 }] }, stops: [stop("a", 53, { value: 1.8 }), stop("b", 106, { value: 0.2 })], comparePlan: true }));
    const late = r.advice.find((a) => a.kind === "late")!;
    expect(late.why!.join(" ")).toMatch(/Expected finish \d\d:\d\d vs target 20:00/);
    expect(r.advice.find((a) => a.kind === "skip")!.why!.join(" ")).toMatch(/over your target|min over/);
  });

  it("offers to MOVE a stop to tomorrow (nothing deleted) when there is a next day", () => {
    const input = { nowMs: at(16, 30), route: { line: LINE, legs: [{ km: 53, minutes: 65 }, { km: 53, minutes: 65 }] }, stops: [stop("a", 53, { value: 1.8 }), stop("b", 106, { value: 0.2 })] };
    const move = buildIntel(scenario({ ...input, canMoveNextDay: true })).advice.find((a) => a.kind === "skip")!;
    expect(move.title).toBe("Move Stop b to tomorrow?");
    expect(move.action).toEqual({ type: "move_next_day", stopId: "b" });
    expect(move.detail).toMatch(/Nothing is deleted/);
    expect(buildIntel(scenario({ ...input, canMoveNextDay: false })).advice.find((a) => a.kind === "skip")!.action).toEqual({ type: "skip", stopId: "b" });
  });

  it("includes an honest trip-health summary", () => {
    const h = buildIntel(scenario()).health;
    expect(h.schedule.label).toBe("Comfortable");
    expect(h.weather.label).toBe("Unknown"); // no forecast in this scenario
    expect(h.timeLeftMin).toBe(10 * 60);
  });
});

describe("weather right now and the sun (the things a traveller checks first)", () => {
  const hours = (from: number, n: number, prob = 20) => Array.from({ length: n }, (_, i) => ({ time: new Date(at(from + i)).toISOString(), tempC: 30 - i * 0.6, precipMm: 0, precipProb: prob + i * 10 }));

  it("gives this hour's forecast and the next six hours, labelled in local time", async () => {
    const { weatherNowFrom } = await import("@/lib/intel/engine");
    const w = weatherNowFrom([{ lat: 17, lng: 80, hours: hours(9, 12) }], { lat: 17, lng: 80 }, at(10, 30), 330)!;
    expect(w.tempC).toBe(29); // the 10:00 hour: 30 - 0.6
    expect(w.precipProb).toBe(30);
    expect(w.next).toHaveLength(6);
    expect(w.next[0]).toMatchObject({ clock: "11:00", precipProb: 40 });
    expect(w.next[5].clock).toBe("16:00");
    expect(w.pointKm).toBe(0);
  });

  it("uses the forecast point nearest to you, and says how far away it was", async () => {
    const { weatherNowFrom } = await import("@/lib/intel/engine");
    const near = { lat: 17, lng: 80.05, hours: hours(9, 4, 5) };
    const far = { lat: 17, lng: 81, hours: hours(9, 4, 95) };
    const w = weatherNowFrom([far, near], { lat: 17, lng: 80 }, at(10, 5), 330)!;
    expect(w.precipProb).toBe(15); // the near one
    expect(w.pointKm).toBeGreaterThan(4);
  });

  it("returns nothing (never a guess) with no forecast or when the forecast doesn't cover now", async () => {
    const { weatherNowFrom } = await import("@/lib/intel/engine");
    expect(weatherNowFrom([], { lat: 17, lng: 80 }, at(10), 330)).toBeNull();
    expect(weatherNowFrom([{ lat: 17, lng: 80, hours: hours(20, 3) }], { lat: 17, lng: 80 }, at(10), 330)).toBeNull();
    expect(buildIntel(scenario()).weatherNow).toBeNull();
  });

  it("is part of the intelligence result when a forecast exists", () => {
    const r = buildIntel(scenario({ weather: [{ lat: 17, lng: 80, hours: hours(9, 10) }] }));
    expect(r.weatherNow?.tempC).toBe(29);
  });

  it("names the next sun event: sunrise before dawn, sunset by day, tomorrow's sunrise at night", async () => {
    const { sunNextFrom } = await import("@/lib/intel/engine");
    const sun = { sunriseMin: 6 * 60 + 8, sunsetMin: 17 * 60 + 52 };
    expect(sunNextFrom(sun, 5 * 60)).toEqual({ label: "Sunrise", clock: "06:08", inMin: 68, tomorrow: false });
    expect(sunNextFrom(sun, 10 * 60)).toEqual({ label: "Sunset", clock: "17:52", inMin: 472, tomorrow: false });
    expect(sunNextFrom(sun, 19 * 60)).toEqual({ label: "Sunrise", clock: "06:08", inMin: (24 - 19) * 60 + 6 * 60 + 8, tomorrow: true });
    expect(sunNextFrom(null, 600)).toBeNull();
    expect(buildIntel(scenario()).sunNext).toMatchObject({ label: "Sunset", tomorrow: false });
  });
});
