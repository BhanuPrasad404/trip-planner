// Where ingested places live. Two implementations behind one interface:
//   SupabasePoiStore — PostGIS in our own database (production; needs SUPABASE_SERVICE_ROLE_KEY for writes)
//   MemoryPoiStore   — in-process fallback so the product still works before the key is configured
import type { LngLat, PoiKind, PoiRecord } from "./types";

export type TileStatus = { status: "ok" | "failed"; fetched_at: string; poi_count: number };

export interface PoiStore {
  readonly id: "supabase" | "memory";
  /** Status of each tile for a group (missing key = never fetched). */
  tileStatus(tileKeys: string[], group: string): Promise<Map<string, TileStatus>>;
  recordTile(tileKey: string, group: string, status: "ok" | "failed", poiCount: number, at: string): Promise<void>;
  savePois(pois: PoiRecord[]): Promise<void>;
  /** Places within `bufferM` of the polyline. */
  inCorridor(line: LngLat[], bufferM: number, kinds: PoiKind[], limit: number): Promise<PoiRecord[]>;
  near(lat: number, lng: number, radiusM: number, kinds: PoiKind[], limit: number): Promise<PoiRecord[]>;
}
