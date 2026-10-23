// "Save this trip" on a ready-made example: it becomes a guided-flow draft (kept on the phone), so the visitor goes through the same save
// step as everyone else (name, dates; sign-up only here) and the saved trip is planned with the same places, kinds of place and answers.
import { emptyDraft, type Draft, type DraftPlace } from "@/lib/intake/draft";
import type { Option } from "@/lib/intake/places";
import type { TripAnswers } from "@/lib/intake/types";
import type { PlaceCategory } from "@/lib/categories";
import type { ExamplePlan } from "./examples";

const option = (id: string, name: string, lat: number, lng: number, area: string): Option => ({ id, name, lat, lng, kind: "place", area, state: null, source: "osm", km: null, calledAs: null });

export function exampleDraft(e: ExamplePlan): Draft {
  const s = e.data.start;
  const i = e.intake as Partial<TripAnswers>;
  const chosen: Partial<TripAnswers> = { days: e.days, endMode: e.endMode, ...(i.pace ? { pace: i.pace } : {}), ...(i.month ? { month: i.month } : {}), ...(i.interests ? { interests: i.interests } : {}) };
  const places: DraftPlace[] = e.places.map((p, k) => ({
    key: `you:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`, said: p.name, must: false, source: "said", evidence: "", status: "sure", reason: null,
    place: option(`example:${e.slug}:${k}`, p.name, p.lat, p.lng, p.area), alternatives: [], category: p.category as PlaceCategory,
  }) as DraftPlace);
  return { ...emptyDraft(), start: { place: option(`example:${e.slug}:start`, s.label, s.lat, s.lng, ""), from: "you" }, chosen, places };
}
