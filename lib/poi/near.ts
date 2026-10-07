// "What's around this point" answered from OUR places database (filled tile by tile), not from a public map server per request.
import { distanceKm } from "@/lib/geo";
import { osmPhoto, type NearbyKind, type NearbyPlace } from "@/lib/nearby";
import type { PoiService } from "./service";
import { groupsOfKinds, KIND_META, type PoiKind } from "./types";

export const NEARBY_TO_POI: Record<NearbyKind, PoiKind[]> = {
  fuel: ["fuel"], food: ["food", "cafe"], pharmacy: ["pharmacy"], atm: ["atm"], hospital: ["hospital"], stay: ["stay"], sights: ["sight", "viewpoint"],
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("places data took too long")), ms))]);

export type NearbyOwn = { places: NearbyPlace[]; pending: Awaited<ReturnType<PoiService["ensureCoverage"]>>["pending"]; complete: boolean };

export async function nearbyFromOwnData(svc: PoiService, kind: NearbyKind, origin: { lat: number; lng: number }, radiusKm: number, limit = 12): Promise<NearbyOwn> {
  const kinds = NEARBY_TO_POI[kind];
  // A tiny segment around the point: the corridor logic then covers a circle-ish area of `radiusKm`, nearest tile first.
  const line: [number, number][] = [[origin.lng, origin.lat], [origin.lng + 0.0001, origin.lat]];
  const cov = await withTimeout(svc.ensureCoverage(line, radiusKm, groupsOfKinds(kinds), { syncBudget: 1 }), 12_000);
  const rows = await svc.store.near(origin.lat, origin.lng, radiusKm * 1000, kinds, 120);

  const seen = new Set<string>();
  const places: NearbyPlace[] = [];
  for (const r of rows) {
    const name = r.name ?? KIND_META[r.kind].label;
    const dedupe = `${name.toLowerCase()}@${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    places.push({
      id: `${r.source}/${r.source_id}`,
      name,
      kind,
      lat: r.lat,
      lng: r.lng,
      km: Math.round(distanceKm(origin, r) * 10) / 10,
      hours: r.tags.opening_hours ?? null,
      photo: osmPhoto(r.tags),
    });
  }
  places.sort((a, b) => a.km - b.km);
  return { places: places.slice(0, limit), pending: cov.pending, complete: cov.ready === cov.total };
}
