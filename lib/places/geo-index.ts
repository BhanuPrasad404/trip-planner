// Searching Trailmate's own India place-name index (built from GeoNames by scripts/build-geo-index.mjs). Pure: the index is passed in,
// so tests use a small hand-made one and the server loads the real file once (lib/places/geo-index-load.ts).
//
// Two jobs, both free and instant (no outside service, no daily limit):
//   searchIndex  — type-ahead for towns, areas, districts and well-known kinds of places, ranked by how well the words match, how
//                  important the place is, and how close it is to the traveller.
//   describeHere — "where am I?": the area and town around a position, so the start field can say "Kukatpally, Hyderabad".
import { distanceKm } from "@/lib/geo";
import { inIndiaBox, normalizeName, type PlaceHit, type PlaceKind } from "./types";

type IndexKind = "city" | "town" | "locality" | "subdistrict" | "district" | "state" | "sight" | "water" | "hill" | "coast" | "park";
export type GeoIndexRow = [name: string, lat: number, lng: number, kind: IndexKind, state: number, district: number, population: number, otherNames?: string[]];
export type GeoIndexData = { version: number; source: string; built: string; states: string[]; districts: string[]; rows: GeoIndexRow[] };

type Entry = {
  i: number;
  name: string;
  norm: string;
  words: string[];
  /** Words of the district and state, for "Kondapalli Krishna"-style searches. */
  areaWords: string[];
  alts: string[];
  /** The other names without a final vowel sign (see bareEnd), worked out once at load, not on every search. */
  altsBare: string[];
  lat: number;
  lng: number;
  kind: IndexKind;
  state: string | null;
  district: string | null;
  pop: number;
  weight: number;
};
export type GeoIndex = { entries: Entry[]; built: string };

/** How much a kind of place matters when several match equally well. Peaks and hills are many and mostly obscure: lowest. */
const KIND_WEIGHT: Record<IndexKind, number> = { city: 14, state: 14, town: 9, district: 8, sight: 6, water: 5, coast: 5, park: 5, locality: 4, subdistrict: 3, hill: 1 };

export function buildIndex(data: GeoIndexData): GeoIndex {
  const entries: Entry[] = [];
  data.rows.forEach((r, i) => {
    const [name, lat, lng, kind, s, d, pop, other] = r;
    if (typeof name !== "string" || !name || !inIndiaBox(lat, lng) || !(kind in KIND_WEIGHT)) return;
    const norm = normalizeName(name);
    if (!norm) return;
    const state = data.states[s] ?? null, district = d >= 0 ? data.districts[d] ?? null : null;
    entries.push({
      i, name, norm, words: norm.split(" "), areaWords: normalizeName(`${district ?? ""} ${state ?? ""}`).split(" ").filter(Boolean),
      alts: (other ?? []).map(normalizeName).filter(Boolean), altsBare: [], lat, lng, kind, state, district, pop: pop > 0 ? pop : 0,
      // Population only lifts real towns: a mandal's or district's figure is the whole area, not how well known the name is.
      weight: KIND_WEIGHT[kind] + (pop > 0 && (kind === "city" || kind === "town") ? Math.log10(pop + 1) * 2.5 : 0),
    });
  });
  for (const e of entries) e.altsBare = e.alts.map(bareEnd);
  return { entries, built: data.built };
}

/** "Rangareddi, Telangana" — the district is left out when it is the place's own name ("Hyderabad, Telangana", not "Hyderabad, Hyderabad, …"). */
export function areaOf(e: { name: string; district: string | null; state: string | null; kind: IndexKind }): string {
  const parts: string[] = [];
  if (e.kind === "state") return "State of India";
  if (e.kind === "district") parts.push("District");
  else if (e.district && normalizeName(e.district) !== normalizeName(e.name)) parts.push(e.district);
  if (e.state) parts.push(e.state);
  return parts.join(", ");
}

export const toHit = (e: Entry): PlaceHit => ({ id: `gn:${e.i}`, name: e.name, lat: e.lat, lng: e.lng, kind: e.kind as PlaceKind, area: areaOf(e), state: e.state, source: "geonames" });

/** Edit distance, giving up as soon as it is over `max` (typos only: "Hydrabad", "Vishakapatnam"). */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** How well the typed words match this place (0 = not at all). Name first, then other names, then "name + district/state" ("Kondapalli Krishna"). */
/** Indian scripts: a word's last vowel sign varies between spellings ("హైదరాబాద్" / "హైదరాబాదు"), so it is ignored when comparing. */
const bareEnd = (s: string) => s.replace(/\p{M}+$/u, "");

// `qb` = bareEnd(q), worked out once per search (this runs for every one of ~70k places on every key press).
function matchScore(e: Entry, q: string, tokens: string[], qb: string): number {
  if (e.norm === q) return 100;
  if (e.norm.startsWith(q)) return 86 - Math.min(10, (e.norm.length - q.length) / 2);
  for (let k = 0; k < e.alts.length; k++) {
    const a = e.alts[k];
    // Below an exact real name (100), so "Goa" the state beats Mormugao, which GeoNames also calls Goa.
    if (a === q || (qb !== q && e.altsBare[k] === qb)) return 84;
    if (a.startsWith(qb) && qb.length >= 2) return 74 - Math.min(10, (a.length - qb.length) / 2);
  }
  if (tokens.length === 1) {
    if (e.words.some((w) => w.startsWith(q))) return 60;
  } else {
    // Every typed word must start a word of the name, the district or the state, and the FIRST must start a word of the name
    // (allowing one slip in it: "Kondapalli Krishna" finds "Kondapalle", Krishna district).
    const rest = tokens.slice(1);
    const t0 = tokens[0];
    const startsName = e.words.some((w) => w.startsWith(t0)) || (t0.length >= 5 && e.words.some((w) => w[0] === t0[0] && withinEdits(t0, w.slice(0, t0.length), 1)));
    if (startsName && rest.every((t) => e.words.some((w) => w.startsWith(t)) || e.areaWords.some((w) => w.startsWith(t)))) return 72;
  }
  // One slip for 5+ letters, two for 9+: compared with the same number of letters at the start of the name.
  if (q.length >= 5 && q[0] === e.norm[0]) {
    const max = q.length >= 9 ? 2 : 1;
    if (withinEdits(q, e.norm.slice(0, q.length), max) || withinEdits(q, e.norm, max)) return 42;
  }
  return 0;
}

export type SearchOpts = { near?: { lat: number; lng: number } | null; limit?: number };

export function searchIndex(ix: GeoIndex, query: string, opts: SearchOpts = {}): PlaceHit[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const tokens = q.split(" ");
  const qb = bareEnd(q);
  const near = opts.near && inIndiaBox(opts.near.lat, opts.near.lng) ? opts.near : null;
  const scored: { e: Entry; s: number }[] = [];
  for (const e of ix.entries) {
    const m = matchScore(e, q, tokens, qb);
    if (m === 0) continue;
    // A place 800 km away loses up to 20 points: a strong match far away still beats a weak one next door.
    const penalty = near ? Math.min(20, distanceKm(near, e) / 40) : 0;
    scored.push({ e, s: m + e.weight - penalty });
  }
  // "Kondapalli Krishna" when the index files it under another district: rather than nothing, show matches for the first word.
  if (scored.length === 0 && tokens.length > 1 && tokens[0].length >= 3) return searchIndex(ix, tokens[0], opts);
  scored.sort((a, b) => b.s - a.s || a.e.i - b.e.i);
  const out: Entry[] = [];
  for (const { e } of scored) {
    // "Hyderabad" the city and "Hyderabad" the district sit on top of each other: show the more useful one only.
    if (out.some((o) => o.norm === e.norm && distanceKm(o, e) < 15)) continue;
    out.push(e);
    if (out.length >= (opts.limit ?? 8)) break;
  }
  return out.map(toHit);
}

/** Words that describe a kind of place, not the place: "Lepakshi temple" and "Lepakshi" name the same place. */
const GENERIC_SUFFIX = /\s+(temple|temples|fort|falls|waterfall|waterfalls|caves?|beach|lake|dam|hills?|valley|peak|palace|park|town|city|village|mandir|gudi|kota|kovil|koil)$/u;
const SUFFIX_TYPE: Record<string, string> = { temple: "temple", temples: "temple", mandir: "temple", gudi: "temple", kovil: "temple", koil: "temple", fort: "fort", kota: "fort", falls: "falls", waterfall: "falls", waterfalls: "falls", cave: "cave", caves: "cave", beach: "beach", lake: "lake", dam: "dam", hill: "hill", hills: "hill", valley: "valley", peak: "peak", palace: "palace", park: "park" };
export const coreName = (s: string) => normalizeName(s).replace(GENERIC_SUFFIX, "").trim();
/** "temple", "lake"… or null. "Ramappa temple" and "Ramappa Lake" are different places. */
export const suffixType = (s: string): string | null => { const m = GENERIC_SUFFIX.exec(normalizeName(s)); return m ? SUFFIX_TYPE[m[1]] ?? null : null; };
const compatible = (a: string, b: string) => { const x = suffixType(a), y = suffixType(b); return !x || !y || x === y; };

export type NamedHit = PlaceHit & {
  km: number | null;
  /** 0 own name of a town/sight/state · 1 another name of a town/sight · 2 own name of a district/mandal · 3 another name of one. */
  tier: 0 | 1 | 2 | 3;
  /** The other name it was found by ("Srisailam" for GeoNames' "Srisailain"), or null when found by its own name. */
  calledAs: string | null;
};
const ADMIN: IndexKind[] = ["district", "subdistrict"];
const POPULATED: IndexKind[] = ["city", "town", "locality"];

/**
 * Places whose name IS what the traveller wrote — the same words (ignoring "temple", "falls"…, but never mixing a temple with a lake), one
 * of its other names, or the same name in an Indian script. Not "starts with": "Kondapalli" must not quietly become "Kondapalli Reserve
 * Forest". Ranked by tier (see NamedHit), then importance and closeness. One real place listed several times (the city, its district and
 * its mandal; two points of the same cave) is collapsed to one, so a name is only "shared" when it really is.
 */
export function findNamed(ix: GeoIndex, query: string, opts: { near?: { lat: number; lng: number } | null; kinds?: IndexKind[]; limit?: number } = {}): NamedHit[] {
  const q = coreName(query);
  if (q.length < 2) return [];
  const qb = bareEnd(q);
  const near = opts.near && inIndiaBox(opts.near.lat, opts.near.lng) ? opts.near : null;
  const found: { e: Entry; km: number | null; tier: NamedHit["tier"]; calledAs: string | null }[] = [];
  for (const e of ix.entries) {
    if (opts.kinds && !opts.kinds.includes(e.kind)) continue;
    const byName = coreName(e.name) === q && compatible(query, e.name);
    // Indian scripts: compare without the final vowel sign on EITHER side ("ಬೆಂಗಳೂರ" from "ಬೆಂಗಳೂರಿನಿಂದ" is "ಬೆಂಗಳೂರು").
    const alt = byName ? null : e.alts.find((a) => (a === q || coreName(a) === q || (!/^[\x20-\x7e]+$/.test(q) && bareEnd(a) === qb)) && compatible(query, a));
    if (!byName && alt === undefined) continue;
    const admin = ADMIN.includes(e.kind);
    const tier = ((admin ? 2 : 0) + (byName ? 0 : 1)) as NamedHit["tier"];
    found.push({ e, km: near ? distanceKm(near, e) : null, tier, calledAs: byName ? null : altDisplay(alt!, e) });
  }
  // "Warangal" is the city, not "Warangal Fort": a fort/temple named after a town only counts when nothing plainly named matches.
  const plainQuery = suffixType(query) === null;
  const plain = found.filter((f) => !(plainQuery && suffixType(f.e.name) !== null));
  const pool = plain.length ? plain : found;
  // The same place listed as a town AND as its district / mandal / state: keep the town.
  const kept = pool.filter((f) => {
    if (ADMIN.includes(f.e.kind)) return !pool.some((g) => POPULATED.includes(g.e.kind) && g.tier <= 1 && distanceKm(g.e, f.e) < 80);
    if (f.e.kind === "state") return !pool.some((g) => g.e.kind === "city" && g.tier === 0 && distanceKm(g.e, f.e) < 150);
    return true;
  });
  kept.sort((a, b) => a.tier - b.tier || (b.e.weight - (b.km ?? 0) / 40) - (a.e.weight - (a.km ?? 0) / 40) || a.e.i - b.e.i);
  const out: typeof kept = [];
  for (const f of kept) { if (!out.some((o) => distanceKm(o.e, f.e) < 5)) out.push(f); if (out.length >= (opts.limit ?? 6)) break; }
  return out.map(({ e, km, tier, calledAs }) => ({ ...toHit(e), km: km === null ? null : Math.round(km), tier, calledAs }));
}

/** Show the other name the way it is written in the index ("Srisailam"), not lower-cased. */
function altDisplay(normAlt: string, e: Entry): string {
  return e.alts.includes(normAlt) ? normAlt.replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase()) : normAlt;
}

const NAMED: IndexKind[] = ["locality", "town", "city", "subdistrict"];

/** The nearest places of the given kinds, closest first, within `maxKm`. */
export function nearestTo(ix: GeoIndex, lat: number, lng: number, kinds: IndexKind[] = NAMED, maxKm = 30, limit = 5): { hit: PlaceHit; km: number; pop: number; kind: IndexKind }[] {
  const dLat = maxKm / 111, dLng = maxKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const found: { e: Entry; km: number }[] = [];
  for (const e of ix.entries) {
    if (Math.abs(e.lat - lat) > dLat || Math.abs(e.lng - lng) > dLng || !kinds.includes(e.kind)) continue;
    const km = distanceKm({ lat, lng }, e);
    if (km <= maxKm) found.push({ e, km });
  }
  found.sort((a, b) => a.km - b.km || a.e.i - b.e.i);
  return found.slice(0, limit).map(({ e, km }) => ({ hit: toHit(e), km, pop: e.pop, kind: e.kind }));
}

/** The biggest towns around a point, biggest first (population from GeoNames). */
export function biggestNear(ix: GeoIndex, lat: number, lng: number, maxKm = 150, limit = 4): PlaceHit[] {
  return nearestTo(ix, lat, lng, ["city", "town"], maxKm, 2000).filter((x) => x.pop > 0 && x.km > 3).sort((a, b) => b.pop - a.pop).slice(0, limit).map((x) => x.hit);
}

/** Within this distance of a named area we say its name; farther than this we say "near …". */
export const AT_PLACE_KM = 2.5;
/** A city counts as "the city you are in" up to this far from its centre. */
export const CITY_KM = 20;

export type HereName = {
  /** "Kukatpally, Hyderabad" or "Near Chevella". */
  name: string;
  /** "Rangareddi, Telangana". */
  area: string;
  /** Straight-line km to the place we named (0 when inside it). */
  km: number;
  /** True when we could only say "near" a place: the caller may ask a finer service. */
  approximate: boolean;
};

/** Name a position from our own index. Null when nothing named is within 30 km (then the caller may ask Nominatim). */
export function describeHere(ix: GeoIndex, lat: number, lng: number): HereName | null {
  if (!inIndiaBox(lat, lng)) return null;
  const near = nearestTo(ix, lat, lng, NAMED, 30, 40);
  if (near.length === 0) return null;
  const first = near.find((x) => x.kind !== "subdistrict") ?? near[0];
  // Second half of the name: the biggest city whose centre is within CITY_KM ("Madhapur, Hyderabad"); in the countryside, the mandal or
  // tehsil around you ("Kantabamsuguda, Araku Valley").
  const city = nearestTo(ix, lat, lng, ["city", "town"], CITY_KM, 500).filter((x) => x.kind === "city" || x.pop >= 100_000).sort((a, b) => b.pop - a.pop)[0];
  const mandal = city ? undefined : near.find((x) => x.kind === "subdistrict" && x.km <= 15);
  const second = city ?? mandal;
  const same = !second || normalizeName(second.hit.name) === normalizeName(first.hit.name);
  const approximate = first.km > AT_PLACE_KM;
  return { name: approximate ? `Near ${first.hit.name}` : same ? first.hit.name : `${first.hit.name}, ${second.hit.name}`, area: first.hit.area, km: Math.round(first.km * 10) / 10, approximate };
}
