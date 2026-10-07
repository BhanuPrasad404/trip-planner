// How far is a day / the whole trip — and HOW do we know?
//   road      every leg comes from a routing service (distance driven)
//   partial   some legs are road distances, the rest are straight-line
//   straight  no road data yet: straight-line distance only (the real drive is usually 20–40% longer)
// The UI must say which one it is. A straight-line number is never shown as "km driven".
import { distanceKm, type GeoPoint } from "@/lib/geo";

export type DistanceBasis = "road" | "partial" | "straight" | "none";
export type StopLeg = { lat: number; lng: number; drive_km: number | null; drive_minutes: number | null };

export type DistanceSummary = {
  basis: DistanceBasis;
  /** Best available km: road where known, straight-line elsewhere. */
  km: number;
  roadKm: number;
  straightKm: number;
  /** Driving minutes — only when every leg has road data. */
  minutes: number | null;
  legs: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Legs of one day: `from` (where the day begins, if known) → stop 1 → stop 2 → … */
export function summarizeDay(stops: StopLeg[], from: GeoPoint | null): DistanceSummary {
  let prev: GeoPoint | null = from;
  let roadKm = 0, straightOnly = 0, minutes = 0, withRoad = 0, legs = 0;
  for (const s of stops) {
    if (prev) {
      legs++;
      const straight = distanceKm(prev, s);
      if (s.drive_km != null && s.drive_minutes != null) { roadKm += s.drive_km; minutes += s.drive_minutes; withRoad++; }
      else straightOnly += straight;
    }
    prev = s;
  }
  if (legs === 0) return { basis: "none", km: 0, roadKm: 0, straightKm: 0, minutes: null, legs: 0 };
  const basis: DistanceBasis = withRoad === legs ? "road" : withRoad === 0 ? "straight" : "partial";
  return { basis, km: round1(roadKm + straightOnly), roadKm: round1(roadKm), straightKm: round1(straightOnly), minutes: basis === "road" ? Math.round(minutes) : null, legs };
}

/** Whole trip = sum of the days, each day starting where the previous one ended. */
export function summarizeTrip(days: StopLeg[][], start: GeoPoint | null): DistanceSummary {
  let from = start;
  const parts: DistanceSummary[] = [];
  for (const d of days) {
    if (d.length === 0) continue;
    parts.push(summarizeDay(d, from));
    from = d[d.length - 1];
  }
  const legs = parts.reduce((a, p) => a + p.legs, 0);
  if (legs === 0) return { basis: "none", km: 0, roadKm: 0, straightKm: 0, minutes: null, legs: 0 };
  const allRoad = parts.every((p) => p.basis === "road" || p.basis === "none");
  const noRoad = parts.every((p) => p.basis === "straight" || p.basis === "none");
  return {
    basis: allRoad ? "road" : noRoad ? "straight" : "partial",
    km: round1(parts.reduce((a, p) => a + p.km, 0)),
    roadKm: round1(parts.reduce((a, p) => a + p.roadKm, 0)),
    straightKm: round1(parts.reduce((a, p) => a + p.straightKm, 0)),
    minutes: allRoad ? parts.reduce((a, p) => a + (p.minutes ?? 0), 0) : null,
    legs,
  };
}

/** Short text for headers. Always says what kind of distance it is. */
export function describeDistance(s: DistanceSummary): string {
  if (s.basis === "none") return "";
  const km = `${Math.round(s.km).toLocaleString("en-IN")} km`;
  if (s.basis === "road") return `${km} by road`;
  if (s.basis === "partial") return `≈${km} (part road, part straight-line)`;
  return `≈${km} straight-line`;
}
