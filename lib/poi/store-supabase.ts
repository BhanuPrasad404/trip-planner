import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoiStore, TileStatus } from "./store";
import type { LngLat, PoiKind, PoiRecord } from "./types";

type Row = { source: string; source_id: string; kind: PoiKind; name: string | null; lat: number; lng: number; tags: Record<string, string> | null; fetched_at: string };
const toRecord = (r: Row): PoiRecord => ({ source: r.source, source_id: r.source_id, kind: r.kind, name: r.name, lat: r.lat, lng: r.lng, tags: r.tags ?? {}, fetched_at: r.fetched_at });

/** PostGIS-backed store. Needs a service-role client for writes (reads would work with any signed-in client). */
export class SupabasePoiStore implements PoiStore {
  readonly id = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async tileStatus(tileKeys: string[], group: string) {
    const out = new Map<string, TileStatus>();
    if (tileKeys.length === 0) return out;
    const { data, error } = await this.db.from("poi_tiles").select("tile_key, status, poi_count, fetched_at").eq("grp", group).in("tile_key", tileKeys);
    if (error) throw new Error(`tileStatus: ${error.message}`);
    for (const r of data ?? []) out.set(r.tile_key as string, { status: r.status as "ok" | "failed", poi_count: r.poi_count as number, fetched_at: r.fetched_at as string });
    return out;
  }

  async recordTile(tileKey: string, group: string, status: "ok" | "failed", poiCount: number, at: string) {
    const { error } = await this.db.from("poi_tiles").upsert({ tile_key: tileKey, grp: group, status, poi_count: poiCount, fetched_at: at }, { onConflict: "tile_key,grp" });
    if (error) throw new Error(`recordTile: ${error.message}`);
  }

  async savePois(pois: PoiRecord[]) {
    for (let i = 0; i < pois.length; i += 500) {
      const chunk = pois.slice(i, i + 500).map((p) => ({ source: p.source, source_id: p.source_id, kind: p.kind, name: p.name, lat: p.lat, lng: p.lng, tags: p.tags, fetched_at: p.fetched_at }));
      const { error } = await this.db.from("pois").upsert(chunk, { onConflict: "source,source_id" });
      if (error) throw new Error(`savePois: ${error.message}`);
    }
  }

  async inCorridor(line: LngLat[], bufferM: number, kinds: PoiKind[], limit: number) {
    if (line.length < 2) return [];
    const { data, error } = await this.db.rpc("pois_in_corridor", { _line: { type: "LineString", coordinates: line }, _buffer_m: Math.round(bufferM), _kinds: kinds, _limit: limit });
    if (error) throw new Error(`inCorridor: ${error.message}`);
    return ((data ?? []) as Row[]).map(toRecord);
  }

  async near(lat: number, lng: number, radiusM: number, kinds: PoiKind[], limit: number) {
    const { data, error } = await this.db.rpc("pois_near", { _lat: lat, _lng: lng, _radius_m: Math.round(radiusM), _kinds: kinds, _limit: limit });
    if (error) throw new Error(`near: ${error.message}`);
    return ((data ?? []) as Row[]).map(toRecord);
  }
}
