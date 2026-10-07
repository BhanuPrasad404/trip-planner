import { distanceKm } from "@/lib/geo";
import { buildRoute, project } from "@/lib/intel/route-geometry";
import type { PoiStore, TileStatus } from "./store";
import type { LngLat, PoiKind, PoiRecord } from "./types";

const MAX_POIS = 60_000; // memory guard for the fallback store

export class MemoryPoiStore implements PoiStore {
  readonly id = "memory" as const;
  private pois = new Map<string, PoiRecord>();
  private tiles = new Map<string, TileStatus>();

  async tileStatus(tileKeys: string[], group: string) {
    const out = new Map<string, TileStatus>();
    for (const k of tileKeys) {
      const s = this.tiles.get(`${group}|${k}`);
      if (s) out.set(k, s);
    }
    return out;
  }

  async recordTile(tileKey: string, group: string, status: "ok" | "failed", poiCount: number, at: string) {
    this.tiles.set(`${group}|${tileKey}`, { status, fetched_at: at, poi_count: poiCount });
  }

  async savePois(pois: PoiRecord[]) {
    for (const p of pois) {
      if (this.pois.size >= MAX_POIS && !this.pois.has(`${p.source}|${p.source_id}`)) this.pois.delete(this.pois.keys().next().value as string);
      this.pois.set(`${p.source}|${p.source_id}`, p);
    }
  }

  async inCorridor(line: LngLat[], bufferM: number, kinds: PoiKind[], limit: number) {
    if (line.length < 2) return [];
    const route = buildRoute(line);
    const want = new Set(kinds);
    const out: { p: PoiRecord; off: number }[] = [];
    for (const p of this.pois.values()) {
      if (!want.has(p.kind)) continue;
      const { offsetM } = project(route, { lat: p.lat, lng: p.lng });
      if (offsetM <= bufferM) out.push({ p, off: offsetM });
    }
    return out.sort((a, b) => a.off - b.off).slice(0, limit).map((x) => x.p);
  }

  async near(lat: number, lng: number, radiusM: number, kinds: PoiKind[], limit: number) {
    const want = new Set(kinds);
    return [...this.pois.values()]
      .filter((p) => want.has(p.kind))
      .map((p) => ({ p, d: distanceKm({ lat, lng }, p) * 1000 }))
      .filter((x) => x.d <= radiusM)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((x) => x.p);
  }
}
