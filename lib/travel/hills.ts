// "What will the road be like?", from facts only.
//   • The shape of the route comes from real elevation numbers (lib/travel/terrain.ts): climbs and descents of a set size.
//   • A climb is linked to a hill-station stop only if (a) the stop's own category says hill station AND (b) the stop sits on the
//     road line near the top of that climb. Height alone never makes a hill station: a plateau road is not Ooty.
//   • We do NOT say anything about bends, hairpins, road surface or mobile signal: the road line we hold is simplified, and elevation
//     does not tell you the road is winding. Those are listed as "not assessed", never guessed.
// Pure: numbers in, sentences out.
import type { TerrainSegment } from "./terrain";

export type RouteCharacter = "flat" | "rolling" | "hilly" | "mountain";
export type HillStop = { id: string; name: string; category: string; /** Distance along the route line, km; null when the stop is not on the line. */ kmAlong: number | null };
export type HillLink = { segment: TerrainSegment; stop: HillStop };

/** A hill-station stop counts as "at the top" of a climb if it lies within this many km (along the road) of where the climb ends. */
export const HILL_LINK_KM = 15;
/** The size of climb we call a mountain climb. */
export const MOUNTAIN_CLIMB_M = 600;
/** Total climbing below this, with no long climb, is "flat". */
export const FLAT_TOTAL_CLIMB_M = 300;

export type Stats = { minM: number; maxM: number; totalClimbM: number; totalDescentM: number } | null;

export function routeCharacter(segments: TerrainSegment[], stats: Stats): { kind: RouteCharacter; headline: string; detail: string } {
  const climbs = segments.filter((s) => s.kind === "climb");
  const biggest = climbs.reduce<TerrainSegment | null>((b, s) => (!b || s.changeM > b.changeM ? s : b), null);
  if (biggest && biggest.changeM >= MOUNTAIN_CLIMB_M) {
    return { kind: "mountain", headline: "A mountain climb on this route", detail: `The biggest climb rises about ${round10(biggest.changeM)} m over ${Math.round(biggest.lengthKm)} km, to about ${biggest.endElevM} m above sea level.` };
  }
  if (climbs.length > 0) {
    return { kind: "hilly", headline: climbs.length === 1 ? "One long climb on this route" : `${climbs.length} long climbs on this route`, detail: `The biggest rises about ${round10(biggest!.changeM)} m over ${Math.round(biggest!.lengthKm)} km.` };
  }
  if (stats && stats.totalClimbM >= FLAT_TOTAL_CLIMB_M) return { kind: "rolling", headline: "Rolling ground, no long climbs", detail: `There are small ups and downs (about ${stats.totalClimbM} m of climbing in total) but no sustained hill.` };
  return { kind: "flat", headline: "Mostly flat", detail: "We found no long climbs on this road." };
}

/** Which climbs lead to a stop whose category says it is a hill station. */
export function hillStationLinks(segments: TerrainSegment[], stops: HillStop[]): HillLink[] {
  const out: HillLink[] = [];
  for (const segment of segments) {
    if (segment.kind !== "climb") continue;
    const stop = stops.find((s) => s.category === "hill_station" && s.kmAlong !== null && s.kmAlong >= segment.startKm && s.kmAlong <= segment.endKm + HILL_LINK_KM);
    if (stop) out.push({ segment, stop });
  }
  return out;
}

export function linkSentence(l: HillLink): string {
  return `This climb leads up to ${l.stop.name}, a hill station on your trip. The road rises about ${round10(l.segment.changeM)} m to roughly ${l.segment.endElevM} m above sea level.`;
}

/** What the evidence supports about driving: slope affects speed, but our time estimates are built from road type, not slope. */
export function implications(segments: TerrainSegment[]): string[] {
  const out: string[] = [];
  if (segments.length > 0) out.push("Driving times are estimated from the type of road, not its slope, so hill sections can take longer than shown. Allow some extra time.");
  if (segments.some((s) => s.steepness === "steep")) out.push("Part of the climb is steep (about 4% or more on average). Heavily loaded or small-engined vehicles slow down on long steep stretches.");
  if (segments.some((s) => s.kind === "descent" && s.steepness === "steep")) out.push("A long steep descent means sustained braking: use a low gear rather than riding the brakes.");
  return out;
}

/** Said every time, so a missing hazard is never read as "no hazard". */
export const NOT_ASSESSED = "We don't measure bends, road surface, landslide risk or mobile coverage, so we say nothing about them. Check local conditions before a mountain drive.";

const round10 = (n: number) => Math.round(n / 10) * 10;
