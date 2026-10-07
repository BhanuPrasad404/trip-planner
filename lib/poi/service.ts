// Fills our own places database from a provider, one map tile at a time, and answers route-aware spatial queries from it.
// Rule: a user request NEVER waits on more than a couple of tiles, and the same tile is never fetched twice at once.
import type { PlacesProvider, PoiGroup } from "@/lib/providers/types";
import type { PoiStore, TileStatus } from "./store";
import { toRecord } from "./taxonomy";
import { tileBBox, tilesAlongLine, type Tile } from "./tiles";
import type { LngLat, PoiKind } from "./types";

export type IngestTask = { tile: Tile; group: PoiGroup };

export type Coverage = {
  /** Tiles the corridor touches (per requested group, so the same tile can count several times). */
  total: number;
  ready: number;
  /** Tasks not done yet: the caller should run them in the background (they are NOT started here). */
  pending: IngestTask[];
  /** Tiles that failed recently and are cooling down. */
  failed: number;
  /** Tiles ingested during this call. */
  fetchedNow: number;
};

type Options = {
  now?: () => number;
  /** Refresh data older than this (OSM places change slowly). */
  maxAgeMs?: number;
  /** After a failure, wait this long before trying the tile again. */
  retryFailedMs?: number;
  fetchImpl?: typeof fetch;
};

const DAY = 86_400_000;

export class PoiService {
  private inflight = new Map<string, Promise<number>>();
  private now: () => number;
  private maxAgeMs: number;
  private retryFailedMs: number;
  private fetchImpl?: typeof fetch;

  constructor(readonly store: PoiStore, private provider: PlacesProvider, opts: Options = {}) {
    this.now = opts.now ?? Date.now;
    this.maxAgeMs = opts.maxAgeMs ?? 45 * DAY;
    this.retryFailedMs = opts.retryFailedMs ?? 10 * 60_000;
    this.fetchImpl = opts.fetchImpl;
  }

  private classifyStatus(s: TileStatus | undefined): "fresh" | "stale" | "missing" | "cooling" {
    if (!s) return "missing";
    const age = this.now() - new Date(s.fetched_at).getTime();
    if (s.status === "failed") return age < this.retryFailedMs ? "cooling" : "missing";
    return age < this.maxAgeMs ? "fresh" : "stale";
  }

  /**
   * Make sure the corridor is covered. Tiles that were never fetched are ingested NOW (nearest-ahead first, up to `syncBudget`),
   * the rest are returned as `pending` so the caller can run them after responding.
   * Stale tiles keep serving their old data while a refresh is queued.
   */
  async ensureCoverage(line: LngLat[], bufferKm: number, groups: PoiGroup[], opts: { syncBudget?: number } = {}): Promise<Coverage> {
    const tiles = tilesAlongLine(line, bufferKm);
    const missing: IngestTask[] = [];
    const stale: IngestTask[] = [];
    let ready = 0;
    let failed = 0;
    for (const group of groups) {
      const status = await this.store.tileStatus(tiles.map((t) => t.key), group);
      for (const tile of tiles) {
        const c = this.classifyStatus(status.get(tile.key));
        if (c === "fresh") ready++;
        else if (c === "stale") { ready++; stale.push({ tile, group }); }
        else if (c === "cooling") failed++;
        else missing.push({ tile, group });
      }
    }

    const budget = Math.max(0, opts.syncBudget ?? 2);
    const now = missing.slice(0, budget);
    const results = await Promise.allSettled(now.map((t) => this.ingest(t)));
    const okNow = results.filter((r) => r.status === "fulfilled").length;
    const failedNow = results.length - okNow;

    return {
      total: tiles.length * groups.length,
      ready: ready + okNow,
      pending: [...missing.slice(budget), ...stale],
      failed: failed + failedNow,
      fetchedNow: okNow,
    };
  }

  /** Fetch one tile from the provider, classify, store, and remember that we did. Concurrent calls for the same tile share one fetch. */
  ingest(task: IngestTask): Promise<number> {
    const id = `${task.group}|${task.tile.key}`;
    const running = this.inflight.get(id);
    if (running) return running;
    const p = this.doIngest(task).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async doIngest({ tile, group }: IngestTask): Promise<number> {
    const at = new Date(this.now()).toISOString();
    try {
      const raw = await this.provider.fetchPlaces(tileBBox(tile), group, this.fetchImpl);
      const seen = new Set<string>();
      const records = [];
      for (const r of raw) {
        const rec = toRecord(r, this.provider.id, at);
        if (!rec || seen.has(rec.source_id)) continue;
        seen.add(rec.source_id);
        records.push(rec);
      }
      await this.store.savePois(records);
      await this.store.recordTile(tile.key, group, "ok", records.length, at);
      return records.length;
    } catch (e) {
      await this.store.recordTile(tile.key, group, "failed", 0, at).catch(() => {});
      throw e;
    }
  }

  corridor(line: LngLat[], bufferM: number, kinds: PoiKind[], limit = 600) {
    return this.store.inCorridor(line, bufferM, kinds, limit);
  }
}
