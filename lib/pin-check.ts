// "Does this pin make sense for this trip?" — catches wrong-state matches before they confuse anyone.
import { distanceKm, type GeoPoint } from "@/lib/geo";

/** A stop further than this from where the trip is going (or from the rest of the trip) gets flagged. */
export const FAR_PIN_KM = 400;
/** A stop this close to the trip's start city is the trip coming home, not a wrong pin. */
export const NEAR_START_KM = 40;

export type PinWarning = { km: number; anchorLabel: string };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * - With a destination: flag stops far from it.
 * - Without one: flag a stop that is far from the MEDIAN of the other stops (needs ≥3 stops,
 *   otherwise there's nothing reliable to compare against).
 */
export function findFarPins(
  places: { id: string; lat: number; lng: number }[],
  destination: (GeoPoint & { label: string }) | null,
  thresholdKm = FAR_PIN_KM,
  /** Places the trip legitimately returns to (its own starting point): never "far from the destination". */
  alsoValid: GeoPoint[] = []
): Record<string, PinWarning> {
  const out: Record<string, PinWarning> = {};
  const nearValid = (p: GeoPoint) => alsoValid.some((v) => distanceKm(v, p) <= NEAR_START_KM);

  if (destination) {
    for (const p of places) {
      if (nearValid(p)) continue;
      const km = distanceKm(destination, p);
      if (km > thresholdKm) out[p.id] = { km, anchorLabel: destination.label };
    }
    return out;
  }

  if (places.length < 3) return out;
  for (const p of places) {
    const others = places.filter((o) => o.id !== p.id);
    const center = { lat: median(others.map((o) => o.lat)), lng: median(others.map((o) => o.lng)) };
    const km = distanceKm(center, p);
    if (km > thresholdKm) out[p.id] = { km, anchorLabel: "your other stops" };
  }
  return out;
}
