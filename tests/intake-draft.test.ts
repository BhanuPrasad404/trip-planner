import { describe, expect, it } from "vitest";
import { effectiveAnswers, emptyDraft, mergePlaceLists, questionsToAsk, summaryChips, tripRequests, withAi, withInstant, type Draft } from "@/lib/intake/draft";
import { readTrip } from "@/lib/intake/read";
import { mergeReadings } from "@/lib/intake/merge";
import { smartDefaults } from "@/lib/intake/defaults";
import type { PlaceMatch } from "@/lib/intake/places";

const HYD = { id: "gn:1", name: "Hyderabad", lat: 17.385, lng: 78.4867, kind: "city" as const, area: "Telangana", state: "Telangana", source: "geonames" as const, km: 0, calledAs: null };
const match = (said: string, name: string, lat: number, lng: number, extra: Partial<PlaceMatch> = {}): PlaceMatch => ({ said, must: false, source: "said", evidence: said, status: "sure", reason: null, place: { id: `x:${name}`, name, lat, lng, kind: "sight", area: "Telangana", state: "Telangana", source: "geonames", km: null, calledAs: null }, alternatives: [], ...extra });

function draftFrom(text: string, places: PlaceMatch[] = []): Draft {
  const instant = readTrip(text, { todayMonth: 10 });
  return withInstant(emptyDraft(), text, { understanding: mergeReadings(instant, null), start: { place: HYD, from: "text" }, places });
}
const defaultsFor = (d: Draft) => smartDefaults({ answers: effectiveAnswers(d, []).answers, month: 10, monthSaid: false, climate: null, inSeason: [] });

describe("the guided flow's draft", () => {
  it("what was written fills the chips; defaults fill the rest, each marked as a default", () => {
    const d = draftFrom("4 rojulu Hyderabad nundi, friends tho beaches");
    const eff = effectiveAnswers(d, defaultsFor(d));
    expect(summaryChips(d, eff).map((c) => `${c.text}${c.source === "default" ? "*" : ""}`)).toEqual(["4 days", "from Hyderabad", "Oct*", "Friends", "Own car*", "Balanced*", "No night driving*", "Beaches", "Return to start*"]);
  });
  it("asks only what's missing, in order, at most 3 — and skipping moves on", () => {
    let d = draftFrom("4 rojulu Hyderabad nundi, friends tho beaches");
    expect(questionsToAsk(d, effectiveAnswers(d, defaultsFor(d)))).toEqual(["month", "mode", "pace"]);
    d = { ...d, skipped: ["month"], chosen: { mode: "bike" } };
    expect(questionsToAsk(d, effectiveAnswers(d, defaultsFor(d)))).toEqual(["pace", "nightDriving", "stay"]);
  });
  it("a tap always wins over what was read", () => {
    const d = { ...draftFrom("4 days from Hyderabad, friends"), chosen: { days: 6 } };
    const eff = effectiveAnswers(d, defaultsFor(d));
    expect(eff.answers.days).toBe(6);
    expect(eff.source.days).toBe("you");
  });
  it("the AI fills in later; a disagreement becomes the FIRST question", () => {
    const text = "Mysore inda 3 dina Chikmagalur, family jothe, amma appa barthare";
    const instant = readTrip(text, { todayMonth: 10 });
    let d = draftFrom(text);
    d = withAi(d, instant, { status: "ok", start: null, places: [match("Chikmagalur", "Chikmagalur", 13.31, 75.77, { source: "ai" })], reading: { answers: { group: { value: "family", source: "ai", evidence: "family jothe" } }, places: [], unbacked: [] } });
    expect(d.ai).toBe("ok");
    expect(d.understanding!.conflicts).toEqual([{ key: "group", said: "family_elders", ai: "family" }]);
    expect(questionsToAsk(d, effectiveAnswers(d, defaultsFor(d)))[0]).toBe("group");
    expect(d.places.map((p) => p.place?.name)).toEqual(["Chikmagalur"]);
  });
  it("AI failed: the draft keeps everything it had, and remembers why (the screen says it)", () => {
    const d = withAi(draftFrom("4 days from Hyderabad"), null, { status: "slow", reading: null, start: null, places: [] });
    expect(d.ai).toBe("slow");
    expect(effectiveAnswers(d, []).answers.days).toBe(4);
  });
  it("the same place found by both readers appears once; a 'missing' one is replaced when the AI finds it", () => {
    const missing: PlaceMatch = { said: "Laknavaram", must: true, source: "said", evidence: "x", status: "missing", reason: "not found", place: null, alternatives: [] };
    const merged = mergePlaceLists(mergePlaceLists([], [match("Warangal", "Warangal", 18, 79.58), missing]), [match("Warangal", "Warangal", 18.0001, 79.5801, { source: "ai" }), match("Laknavaram", "Laknavaram", 18.155, 80.03, { source: "ai" })]);
    expect(merged.map((p) => `${p.place?.name}:${p.status}:${p.must}`)).toEqual(["Warangal:sure:false", "Laknavaram:sure:true"]);
  });
  it("the trip it creates: the existing endpoints' shapes, must-sees as 'Must do', a whole state never a stop", () => {
    const d = draftFrom("4 days from Hyderabad", [
      match("Warangal", "Warangal Fort", 17.95, 79.62, { must: true }),
      match("Ramappa", "Ramappa Temple", 18.26, 79.94),
      { ...match("Goa", "Goa", 15.3, 74.08), place: { ...match("Goa", "Goa", 15.3, 74.08).place!, kind: "state" }, status: "check" },
      { said: "Xyz", must: false, source: "said", evidence: "", status: "missing", reason: "", place: null, alternatives: [] },
    ]);
    const r = tripRequests(d, effectiveAnswers(d, defaultsFor(d)));
    expect(r.trip).toMatchObject({ name: "Hyderabad · Warangal Fort, Ramappa Temple · 4 days", start_city: "Hyderabad", end_mode: "start", num_days: 4, start_date: null });
    expect(r.trip.intake).toMatchObject({ mode: "car", pace: "balanced", night_driving: false, month: 10 });
    expect(r.places.map((p) => `${p.name}:${p.category}:${"priority" in p ? p.priority : "-"}`)).toEqual(["Warangal Fort:fort:must", "Ramappa Temple:temple:-"]);
  });
});
