// The state code of every row by the nearest place in our offline list (lib/catalog/regions.ts stateCodeFinder), for the extract steps.
// A grid over the list (cells of 0.25°, ~28 km) so ~100k lookups take seconds, not a scan of all 70k entries each.
import { distanceKm } from "@/lib/geo";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { STATE_FROM_INDEX_KM, stateCodeFinder } from "@/lib/catalog/regions";
import type { CatalogRow } from "@/lib/catalog/types";

const CELL = 0.25;

export async function addStateCodes(rows: CatalogRow[]): Promise<{ withState: number }> {
  const ix = await loadGeoIndex();
  if (!ix) throw new Error("data/geo/india-places.json.gz couldn't be read: run from the project folder");
  const grid = new Map<string, { lat: number; lng: number; state: string }[]>();
  for (const e of ix.entries) {
    if (!e.state) continue;
    const k = `${Math.floor(e.lat / CELL)}|${Math.floor(e.lng / CELL)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push({ lat: e.lat, lng: e.lng, state: e.state });
  }
  const reach = Math.ceil(STATE_FROM_INDEX_KM / (CELL * 100)) + 1;
  const nearestState = (lat: number, lng: number, maxKm: number): string | null => {
    let best: { km: number; state: string } | null = null;
    const gy = Math.floor(lat / CELL), gx = Math.floor(lng / CELL);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      for (const e of grid.get(`${gy + dy}|${gx + dx}`) ?? []) {
        const km = distanceKm({ lat, lng }, e);
        if (km <= maxKm && (!best || km < best.km)) best = { km, state: e.state };
      }
    }
    return best?.state ?? null;
  };
  const codeAt = stateCodeFinder(nearestState);
  let withState = 0;
  for (const r of rows) { r.state_code = codeAt(r.lat, r.lng); if (r.state_code) withState++; }
  return { withState };
}
