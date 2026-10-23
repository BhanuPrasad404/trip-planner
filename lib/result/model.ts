// What the result screen ("Your plan") shows, worked out from the engine's answer: the same for a saved trip and for a ready-made
// example, so both look and behave the same. Pure: no fetching here.
import type { EngineView } from "@/lib/engine/types";
import type { PlanOption } from "@/lib/trip-builder/types";

export type Pt = { lat: number; lng: number };
export type ResultPlace = Pt & { id: string; name: string };
export type ResultData = {
  options: PlanOption[];
  engine: EngineView;
  places: ResultPlace[];
  start: Pt & { label: string };
  end: (Pt & { label: string }) | null;
};

/** The plan for a style, and the engine's extras for it. */
export function variantOf(d: ResultData, style: string) {
  const option = d.options.find((o) => o.style === style) ?? d.options[0] ?? null;
  const view = option ? d.engine.variants.find((v) => v.style === option.style) ?? null : null;
  return { option, view };
}

/** Stop numbers across the whole plan (1, 2, 3…), the same on the map and in the day cards, so nothing depends on colour. */
export function stopNumbers(option: PlanOption): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const d of option.days) for (const s of d.stops) m.set(s.placeId, ++n);
  return m;
}

/**
 * The points each day drives through, in order, for drawing its road on the map: where the day starts (the trip start, the end of the
 * last drive day, or the previous day's last stop), its stops, and the drive back / on to the end when the plan has one.
 */
export function dayPoints(d: ResultData, style: string): { day: number; points: Pt[] }[] {
  const { option, view } = variantOf(d, style);
  if (!option) return [];
  const byId = new Map(d.places.map((p) => [p.id, p]));
  const lastOut = view?.transitOut.at(-1)?.at ?? null;
  let from: Pt = lastOut ?? d.start;
  const out: { day: number; points: Pt[] }[] = [];
  for (const day of option.days) {
    const stops = day.stops.map((s) => byId.get(s.placeId)).filter((p): p is ResultPlace => !!p);
    if (!stops.length) continue;
    const pts: Pt[] = [from, ...stops];
    if (day.returnLeg) pts.push(d.end && d.end.label === day.returnLeg.to ? d.end : day.returnLeg.to === d.start.label ? d.start : d.end ?? d.start);
    out.push({ day: day.day, points: pts.map(({ lat, lng }) => ({ lat, lng })) });
    from = stops[stops.length - 1];
  }
  return out;
}

/** A plain line for the plan's state: fits, places left out, or doesn't fit in these days (and how many would). */
export function verdict(option: PlanOption, view: EngineView["variants"][number] | null, numDays: number): { tone: "ok" | "warn" | "bad"; text: string; needDays: number | null } {
  const left = option.removed.length;
  const placed = option.totals.places;
  if (placed === 0) return { tone: "bad", text: `Doesn't fit in ${numDays} ${numDays === 1 ? "day" : "days"}`, needDays: view?.needDays ?? null };
  if (view && !view.feasible) return { tone: "bad", text: "Doesn't fit as asked", needDays: view.needDays };
  if (left > 0) return { tone: "warn", text: `${left} ${left === 1 ? "place" : "places"} left out`, needDays: view?.needDays ?? null };
  return { tone: "ok", text: `All ${placed} ${placed === 1 ? "place fits" : "places fit"}`, needDays: null };
}
