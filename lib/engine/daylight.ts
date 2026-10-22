// No driving after dark (when refused): sunset from the NOAA formula (lib/intel/sun.ts, pure maths) at the place, on the trip's date.
import { sunTimes } from "@/lib/intel/sun";

/** UTC ms of local noon on trip day `day` (1-based), counting from `firstDateISO`. */
export function noonOf(firstDateISO: string, day: number, utcOffsetMin = 330): number {
  const [y, m, d] = firstDateISO.split("-").map(Number);
  return Date.UTC(y, m - 1, d + day - 1, 12) - utcOffsetMin * 60_000;
}

/** Sunset (minutes after local midnight) at a point on trip day `day`. Null where the sun doesn't set (never in India). */
export function sunsetAt(p: { lat: number; lng: number }, firstDateISO: string, day: number, utcOffsetMin = 330): number | null {
  return sunTimes(p.lat, p.lng, noonOf(firstDateISO, day, utcOffsetMin), utcOffsetMin)?.sunsetMin ?? null;
}

/** The earliest sunset over these points and days: a safe single "finish by" time for the whole trip. */
export function earliestSunset(points: { lat: number; lng: number }[], firstDateISO: string, days: number, utcOffsetMin = 330): number | null {
  let min: number | null = null;
  for (let d = 1; d <= Math.max(1, days); d++) for (const p of points) { const s = sunsetAt(p, firstDateISO, d, utcOffsetMin); if (s !== null && (min === null || s < min)) min = s; }
  return min;
}

export const clockText = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
