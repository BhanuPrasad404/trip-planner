// What a screen sends to ask about a place's hours, or the places in and around it: read from the query string and checked. Pure (the
// routes in app/api/places/* use it, the tests call it directly). Unknown or malformed fields are refused, never guessed.
import { z } from "zod";
import { EXPLORE_CATEGORY_IDS } from "@/lib/explore/categories";
import { inIndiaBox, type PlaceKind } from "@/lib/places/types";
import { dateOf, INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { placeRole, type RoleAnswer } from "./role";
import { nearestTo, type GeoIndex } from "@/lib/places/geo-index";
import { AREA_MATCH_KM, sameName, settlementOf, type Nearby } from "@/lib/engine/settlement";

const KINDS = ["city", "town", "locality", "village", "subdistrict", "district", "state", "sight", "water", "hill", "coast", "park", "station", "airport", "place"] as const;
const num = z.coerce.number().refine(Number.isFinite);
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().or(z.literal("").transform(() => undefined));

export const placeQuerySchema = z.object({
  name: z.string().trim().min(1).max(120),
  lat: num.pipe(z.number().min(-90).max(90)),
  lng: num.pipe(z.number().min(-180).max(180)),
  /** The visit date in India time; today when not given. */
  date: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => Number.isFinite(Date.parse(`${d}T00:00:00Z`)))),
  kind: opt(z.enum(KINDS)),
  category: opt(z.enum(EXPLORE_CATEGORY_IDS)),
  wd: opt(z.string().regex(/^Q\d{1,12}$/)),
  osm: opt(z.string().regex(/^(node|way|relation)\/\d{1,15}$/)),
  wdType: opt(z.string().regex(/^Q\d{1,12}$/)),
  osmType: opt(z.string().regex(/^[a-z_:]{1,40}=[a-z0-9_;:-]{1,40}$/)),
  pop: opt(num.pipe(z.number().int().min(0).max(50_000_000))),
  state: opt(z.string().trim().min(2).max(80)),
  /** "temple,fort": narrow the places around to these kinds. */
  kinds: opt(z.string().max(200).transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(EXPLORE_CATEGORY_IDS)).max(10))),
});
export type PlaceQuery = z.infer<typeof placeQuerySchema> & { date: string; role: RoleAnswer };

/**
 * When the screen didn't say what the place is (a trip stop): is it a town or an area by our India index? The same rule the planner uses
 * (lib/engine/settlement.ts): a city, town or area of the SAME NAME within a few km. Otherwise the query is left as it was.
 */
export function withIndexRole(q: PlaceQuery, ix: GeoIndex | null): PlaceQuery {
  if (!ix || q.kind || q.category || q.wdType || q.osmType) return q;
  const near: Nearby[] = nearestTo(ix, q.lat, q.lng, ["city", "town", "locality", "subdistrict", "district"], AREA_MATCH_KM, 12).map((x) => ({ name: x.hit.name, kind: x.kind, pop: x.pop, km: x.km }));
  const s = settlementOf({ name: q.name, lat: q.lat, lng: q.lng, category: "other", visitMin: null }, near);
  if (!s) return q;
  const hit = near.find((n) => n.km <= AREA_MATCH_KM && sameName(q.name, n.name));
  const kind = s.role === "area" ? (hit?.kind === "district" ? "district" : "subdistrict") : hit?.kind === "city" || s.role === "city" ? "city" : "town";
  return { ...q, kind, pop: s.pop, role: placeRole({ name: q.name, kind: kind as PlaceKind, population: s.pop }) };
}

/** The query string → a checked place query (with its level worked out), or the first problem in plain words. */
export function readPlaceQuery(params: URLSearchParams, nowMs: number = Date.now()): { ok: true; q: PlaceQuery } | { ok: false; error: string } {
  const raw = Object.fromEntries([...params.entries()].filter(([k]) => k in placeQuerySchema.shape));
  const r = placeQuerySchema.safeParse(raw);
  if (!r.success) { const i = r.error.issues[0]; return { ok: false, error: `${i.path.join(".") || "query"}: ${i.message}` }; }
  if (!inIndiaBox(r.data.lat, r.data.lng)) return { ok: false, error: "The place must be in India." };
  const role = placeRole({ name: r.data.name, kind: (r.data.kind ?? null) as PlaceKind | null, population: r.data.pop ?? null, category: r.data.category ?? null, wdType: r.data.wdType ?? null, osmType: r.data.osmType ?? null });
  return { ok: true, q: { ...r.data, date: r.data.date ?? dateOf(nowMs, INDIA_UTC_OFFSET_MIN), role } };
}
