// Core geography logic: given a start point and a scattered list of places,
// figure out a sensible visiting order and split it into days — this is the
// actual answer to "these places are in different parts of the state, which
// day should each one go on."

type GeoPoint = { lat: number; lng: number };

type SequenceInput = {
  id: string;
  lat: number;
  lng: number;
  typicalDurationHours?: number; // from season_tags, if matched — defaults to 2
};

type SequencedPlace = SequenceInput & {
  day_number: number;
  sequence_order: number;
};

// Haversine formula — real distance in km between two lat/lng points,
// accounting for the Earth's curvature (a flat lat/lng subtraction would be
// meaningfully wrong at India's latitudes).
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371; // Earth radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Greedy nearest-neighbor ordering: starting from the trip's start point,
// repeatedly visit whichever remaining place is closest to the last one
// visited. This is the standard, well-understood approach for this exact
// problem (a simplified traveling-salesman heuristic) — not perfect, but
// avoids the "zig-zag across the state" problem completely, which is the
// actual complaint this feature exists to fix.
function orderByNearestNeighbor(start: GeoPoint, places: SequenceInput[]): SequenceInput[] {
  const remaining = [...places];
  const ordered: SequenceInput[] = [];
  let current: GeoPoint = start;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(current, remaining[i]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    const [next] = remaining.splice(nearestIdx, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

// Splits the ordered route into days, balancing by total time-on-ground per
// day (using each place's typical visit duration) rather than a flat place
// count — a 6-hour trek and a 1-hour viewpoint shouldn't count the same.
const MAX_HOURS_PER_DAY = 8;

export function buildDayPlan(
  start: GeoPoint,
  places: SequenceInput[],
  numDays: number
): SequencedPlace[] {
  const ordered = orderByNearestNeighbor(start, places);

  const result: SequencedPlace[] = [];
  let day = 1;
  let hoursUsedToday = 0;
  let sequenceInDay = 1;

  for (const place of ordered) {
    const duration = place.typicalDurationHours ?? 2;

    if (hoursUsedToday + duration > MAX_HOURS_PER_DAY && day < numDays) {
      day += 1;
      hoursUsedToday = 0;
      sequenceInDay = 1;
    }

    result.push({ ...place, day_number: day, sequence_order: sequenceInDay });
    hoursUsedToday += duration;
    sequenceInDay += 1;
  }

  return result;
}