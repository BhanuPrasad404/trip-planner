// The shared photo cache: one answer per place, for everyone, remembered across visits and server instances.
//
// Rules this file keeps:
//  - Reading never trusts the database: every stored photo is re-checked against the same gates as a fresh one
//    (Commons-only URL, free licence, expected hosts), so a bad row can never put a wrong or unlicensed image on screen.
//  - Entries carry the resolver VERSION: after the algorithm improves, old "no photo" answers are ignored instead of sticking for weeks.
//  - Writes use the service role (RLS lets no signed-in user write), and every failure degrades to an in-memory cache. The cache is
//    a speed-up, never a dependency: with the table missing (migration not applied) or the database down, lookups still work.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { isFreeLicence, parseCommonsUrl } from "./safety";
import type { NoPhotoReason, PlacePhoto } from "./types";

/** Bump when the matching/ranking rules change in a way that could turn an old answer wrong. */
export const RESOLVER_VERSION = 2;
export const FOUND_TTL_MS = 30 * 24 * 3_600_000;
export const NONE_TTL_MS = 30 * 24 * 3_600_000;

export type StoredPhoto = { status: "found"; photo: PlacePhoto } | { status: "none"; reason: NoPhotoReason };
export type StoreEntry = { key: string; name: string; lat: number; lng: number; value: StoredPhoto; ttlMs: number };

export interface PhotoStore {
  getMany(keys: string[]): Promise<Map<string, StoredPhoto>>;
  putMany(entries: StoreEntry[]): Promise<void>;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Same place, however it was typed: name without accents/brackets/punctuation + a ~1 km cell. */
export function photoKey(name: string, lat: number, lng: number): string {
  const n = fold(name.replace(/\([^)]*\)/g, " ")).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 100);
  return `${n}@${lat.toFixed(2)},${lng.toFixed(2)}`;
}

const photoSchema = z.object({
  url: z.string(), srcSet: z.string().optional(), width: z.number(), height: z.number(), title: z.string(), pageUrl: z.string(), source: z.literal("wikipedia"),
  creditUrl: z.string().optional(), author: z.string().nullable().optional(), licence: z.string(), licenceUrl: z.string().nullable().optional(),
  file: z.string().optional(), wikidata: z.string().nullable().optional(), via: z.enum(["exact", "search", "geosearch"]).optional(),
}).strict();
const REASONS: NoPhotoReason[] = ["no_page", "far", "disambiguation", "no_image", "image_rejected", "licence"];

const host = (raw: string | undefined) => { try { return raw ? new URL(raw).hostname : null; } catch { return null; } };

/** A stored photo is used only if it STILL passes every gate. Anything odd is dropped (and will simply be looked up again). */
export function validateStoredPhoto(raw: unknown): PlacePhoto | null {
  const p = photoSchema.safeParse(raw);
  if (!p.success) return null;
  const x = p.data;
  if (!parseCommonsUrl(x.url) || !isFreeLicence(x.licence)) return null;
  if (host(x.pageUrl) !== "en.wikipedia.org" || new URL(x.pageUrl).protocol !== "https:") return null;
  if (x.creditUrl && (host(x.creditUrl) !== "commons.wikimedia.org" || new URL(x.creditUrl).protocol !== "https:")) return null;
  if (x.srcSet && !x.srcSet.split(",").every((part) => parseCommonsUrl(part.trim().split(/\s+/)[0] ?? ""))) return null;
  return x as PlacePhoto;
}

export class MemoryPhotoStore implements PhotoStore {
  private rows = new Map<string, { value: StoredPhoto; expires: number }>();
  constructor(private now: () => number = Date.now, private max = 2_000) {}
  async getMany(keys: string[]) {
    const out = new Map<string, StoredPhoto>();
    for (const k of keys) {
      const r = this.rows.get(k);
      if (r && r.expires > this.now()) out.set(k, r.value);
    }
    return out;
  }
  async putMany(entries: StoreEntry[]) {
    for (const e of entries) {
      if (this.rows.size >= this.max && !this.rows.has(e.key)) this.rows.delete(this.rows.keys().next().value as string);
      this.rows.set(e.key, { value: e.value, expires: this.now() + e.ttlMs });
    }
  }
}

const TABLE = "place_photo_cache";
const DISABLE_MS = 5 * 60_000;

export class SupabasePhotoStore implements PhotoStore {
  private disabledUntil = 0;
  private fallback: MemoryPhotoStore;
  constructor(private db: SupabaseClient, private now: () => number = Date.now) { this.fallback = new MemoryPhotoStore(now); }

  /** After a database error, use memory for a few minutes (one log line) instead of failing — or logging — on every request. */
  private trip(where: string, message: string) {
    if (this.now() >= this.disabledUntil) console.error(`[place-photos] cache ${where} failed, using memory for 5 min: ${message}`);
    this.disabledUntil = this.now() + DISABLE_MS;
  }
  private down = () => this.now() < this.disabledUntil;

  async getMany(keys: string[]): Promise<Map<string, StoredPhoto>> {
    const out = await this.fallback.getMany(keys);
    const need = keys.filter((k) => !out.has(k));
    if (need.length === 0 || this.down()) return out;
    try {
      const { data, error } = await this.db.from(TABLE).select("key,status,photo,reason").in("key", need).eq("algo", RESOLVER_VERSION).gt("expires_at", new Date(this.now()).toISOString());
      if (error) { this.trip("read", error.message); return out; }
      for (const row of (data ?? []) as { key: string; status: string; photo: unknown; reason: string | null }[]) {
        if (row.status === "found") {
          const photo = validateStoredPhoto(row.photo);
          if (photo) out.set(row.key, { status: "found", photo });
        } else if (row.status === "none") {
          out.set(row.key, { status: "none", reason: (REASONS as string[]).includes(row.reason ?? "") ? (row.reason as NoPhotoReason) : "no_page" });
        }
      }
    } catch (e) { this.trip("read", e instanceof Error ? e.message : String(e)); }
    return out;
  }

  async putMany(entries: StoreEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.fallback.putMany(entries); // always keep the local copy: it is what makes the next request fast on this instance
    if (this.down()) return;
    const at = new Date(this.now()).toISOString();
    const rows = entries.map((e) => ({
      key: e.key, name: e.name.slice(0, 120), lat: e.lat, lng: e.lng, status: e.value.status,
      photo: e.value.status === "found" ? e.value.photo : null, reason: e.value.status === "none" ? e.value.reason : null,
      algo: RESOLVER_VERSION, fetched_at: at, expires_at: new Date(this.now() + e.ttlMs).toISOString(),
    }));
    try {
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await this.db.from(TABLE).upsert(rows.slice(i, i + 100), { onConflict: "key" });
        if (error) { this.trip("write", error.message); return; }
      }
    } catch (e) { this.trip("write", e instanceof Error ? e.message : String(e)); }
  }
}

let memory: MemoryPhotoStore | null = null;
let shared: PhotoStore | null = null;
/** Database cache when the service key is configured (production), otherwise memory (local development). */
export function getPhotoStore(): PhotoStore {
  if (shared) return shared;
  shared = hasAdminAccess() ? new SupabasePhotoStore(createAdminClient()) : (memory ??= new MemoryPhotoStore());
  return shared;
}
