// The shared Explore cache: one ranked list per region and category, for everyone, across server instances.
//
// Rules this file keeps (same as the photo cache):
//  - Reading never trusts the database: every stored item is re-validated, so a bad row can never put a wrong link or a foreign image
//    on a traveller's screen. A row that fails validation is ignored (and simply fetched again).
//  - Rows carry a version; when the rules change, older rows are ignored instead of lingering.
//  - Every failure degrades to an in-memory cache. The cache is a speed-up, never a dependency: with the table missing or the
//    database down, Explore still works (just slower, and per server instance).
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { EXPLORE_CATEGORY_IDS } from "./categories";
import { safeHttpUrl, type ExploreItem } from "./items";

/** Bump when parsing, ranking or the query changes in a way that makes older lists wrong. */
export const EXPLORE_VERSION = 1;
/** A list this young is served without asking OpenStreetMap again. */
export const FRESH_MS = 3 * 24 * 3_600_000;
/** An older list is still better than an error when the map servers are down; after this it is dropped. */
export const STALE_OK_MS = 30 * 24 * 3_600_000;
export const MAX_ITEMS = 460;

export type StoredList = { items: ExploreItem[]; fetchedAt: number };
export interface ExploreStore {
  get(key: string): Promise<StoredList | null>;
  put(key: string, items: ExploreItem[]): Promise<void>;
}

const host = (raw: string) => { try { const u = new URL(raw); return u.protocol === "https:" ? u.hostname : null; } catch { return null; } };
const commonsUrl = (raw: string) => ["upload.wikimedia.org", "commons.wikimedia.org"].includes(host(raw) ?? "");

const itemSchema = z.object({
  id: z.string().regex(/^(node|way|relation)\/\d{1,15}$/),
  name: z.string().min(2).max(100),
  category: z.enum(EXPLORE_CATEGORY_IDS),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  notable: z.boolean(), heritage: z.boolean(),
  hours: z.string().max(120).nullable(),
  website: z.string().max(300).nullable().refine((v) => v === null || safeHttpUrl(v) !== null, "bad website"),
  wikipedia: z.string().max(300).nullable().refine((v) => v === null || host(v) === "en.wikipedia.org", "bad wikipedia link"),
  wikidata: z.string().regex(/^Q\d{1,12}$/).nullable(),
  photo: z.object({
    url: z.string().max(600).refine(commonsUrl, "photo must be on Wikimedia"), source: z.enum(["osm", "commons"]),
    creditUrl: z.string().max(600).refine((v) => host(v) === "commons.wikimedia.org", "bad credit link").optional(),
    srcSet: z.string().max(2000).optional(), author: z.string().max(100).nullable().optional(), licence: z.string().max(60).optional(),
  }).strict().nullable(),
}).strict();

/** Only items that still pass every check; anything else is dropped. */
export function validateStoredItems(raw: unknown): ExploreItem[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) return null;
  const out: ExploreItem[] = [];
  for (const r of raw) { const p = itemSchema.safeParse(r); if (p.success) out.push(p.data as ExploreItem); }
  return raw.length > 0 && out.length === 0 ? null : out;
}

export class MemoryExploreStore implements ExploreStore {
  private rows = new Map<string, StoredList>();
  constructor(private now: () => number = Date.now, private max = 200) {}
  async get(key: string) {
    const r = this.rows.get(key);
    return r && this.now() - r.fetchedAt < STALE_OK_MS ? r : null;
  }
  async put(key: string, items: ExploreItem[]) {
    if (this.rows.size >= this.max && !this.rows.has(key)) this.rows.delete(this.rows.keys().next().value as string);
    this.rows.set(key, { items, fetchedAt: this.now() });
  }
}

const TABLE = "explore_cache";
const DISABLE_MS = 5 * 60_000;

export class SupabaseExploreStore implements ExploreStore {
  private disabledUntil = 0;
  private fallback: MemoryExploreStore;
  constructor(private db: SupabaseClient, private now: () => number = Date.now) { this.fallback = new MemoryExploreStore(now); }

  private trip(where: string, message: string) {
    if (this.now() >= this.disabledUntil) console.error(`[explore] cache ${where} failed, using memory for 5 min: ${message}`);
    this.disabledUntil = this.now() + DISABLE_MS;
  }

  async get(key: string): Promise<StoredList | null> {
    const local = await this.fallback.get(key);
    if (local && this.now() - local.fetchedAt < FRESH_MS) return local;
    if (this.now() < this.disabledUntil) return local;
    try {
      const { data, error } = await this.db.from(TABLE).select("payload,fetched_at").eq("key", key).eq("algo", EXPLORE_VERSION).gt("expires_at", new Date(this.now()).toISOString()).maybeSingle();
      if (error) { this.trip("read", error.message); return local; }
      if (!data) return local;
      const items = validateStoredItems((data as { payload: unknown }).payload);
      const at = Date.parse((data as { fetched_at: string }).fetched_at);
      if (!items || !Number.isFinite(at)) return local;
      return !local || at > local.fetchedAt ? { items, fetchedAt: at } : local;
    } catch (e) { this.trip("read", e instanceof Error ? e.message : String(e)); return local; }
  }

  async put(key: string, items: ExploreItem[]): Promise<void> {
    await this.fallback.put(key, items);
    if (this.now() < this.disabledUntil) return;
    const at = new Date(this.now());
    try {
      const { error } = await this.db.from(TABLE).upsert({ key, payload: items, item_count: items.length, algo: EXPLORE_VERSION, fetched_at: at.toISOString(), expires_at: new Date(at.getTime() + STALE_OK_MS).toISOString() }, { onConflict: "key" });
      if (error) this.trip("write", error.message);
    } catch (e) { this.trip("write", e instanceof Error ? e.message : String(e)); }
  }
}

let memory: MemoryExploreStore | null = null;
let shared: ExploreStore | null = null;
/** Database cache when the service key is configured (production), otherwise memory (local development). */
export function getExploreStore(): ExploreStore {
  if (shared) return shared;
  shared = hasAdminAccess() ? new SupabaseExploreStore(createAdminClient()) : (memory ??= new MemoryExploreStore());
  return shared;
}
