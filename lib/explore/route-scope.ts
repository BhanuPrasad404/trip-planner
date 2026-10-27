// Turns the road line into something the map query can take: fewer points, same road. Pure.
import { MAX_ROUTE_POINTS } from "./query";

/** At most `max` points, always keeping the first and the last. Even steps along the line: the corridor is kilometres wide, so a point more or less changes nothing. */
export function decimateLine(line: [number, number][], max = MAX_ROUTE_POINTS): [number, number][] {
  const clean = line.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (clean.length <= max) return clean;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(clean[Math.round((i * (clean.length - 1)) / (max - 1))]);
  return out;
}

/** The corridor widths the traveller may choose (km either side of the road). */
export const CORRIDOR_KM = [5, 10, 20] as const;
export type CorridorKm = (typeof CORRIDOR_KM)[number];
export const DEFAULT_CORRIDOR_KM: CorridorKm = 10;
