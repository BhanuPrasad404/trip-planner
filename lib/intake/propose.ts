// "Plan it for me": the traveller knows a hub (Tirupati) and little else. We turn REAL places round it into three ready plans
// (Relaxed, Balanced, Most places), each split into days, with the reason for every stop.
//
// The rules that keep it honest:
//   • Only places that exist on the map (Explore's data). Nothing is invented, by us or by an AI.
//   • Every sentence is made from a number we really have: the distance and drive time from the hub (by road when a routing service
//     answered, otherwise a labelled estimate), whether somebody linked the place to Wikipedia, heritage listing, the traveller's own interests.
//   • "Usually" wording where the only basis is the KIND of place (a waterfall usually means a walk in). Opening hours are shown as written on the map.
//   • Rare kinds (forts, waterfalls, beaches, parks) may be unlisted on Wikipedia; the common kinds (every shrine, every pond) must be notable.
// Pure and deterministic: the caller fetched the places and the road times.
import type { PlaceCategory } from "@/lib/categories";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { exploreCategory } from "@/lib/explore/categories";
import { exploreRef, sourceLabel, type ExploreItem } from "@/lib/explore/items";
import { distanceKm } from "@/lib/geo";
import { normalizeName } from "@/lib/places/types";
import { optimizeOpenPath } from "@/lib/trip-builder/tour";
import { INTEREST_KINDS } from "./similar";
import { INTEREST_LABEL, type Group, type Interest, type Pace } from "./types";

export type Hub = { lat: number; lng: number; name: string };
export type Matrix = { durations: number[][]; distances: number[][]; source: string };
export type Effort = "easy" | "moderate" | "climb";
export type Pick = {
  id: string; name: string; lat: number; lng: number; category: ExploreCategoryId;
  hubKm: number; hubMin: number; basis: "road" | "estimate";
  effort: Effort; notable: boolean; hours: string | null; wikipedia: string | null;
  why: string[];
  /** Where the place came from and the date of that data ("OpenStreetMap, 28 Oct 2026"), or null for a live map answer. */
  source: string | null;
};
export type PlanDay = { day: number; title: string; picks: Pick[]; driveMin: number };
export type PlanId = Pace;
export type ProposedPlan = { id: PlanId; title: string; blurb: string; days: PlanDay[]; count: number; driveMin: number; notes: string[] };
export type Ask = { hub: Hub; /** Where the traveller starts: a hub far from it costs days of driving. */ start?: Hub | null; /** Coming back the same way (default): the drive is counted twice. */ roundTrip?: boolean; days: number; group: Group | null; interests: Interest[]; pace: Pace | null; maxDriveHours: number | null };

/** The most a hub search looks at: Explore's circle search is limited to 50 km. */
export const SEARCH_RADIUS_KM = 50;
/** The road time of a drive is padded the way the plan pads it, so this never promises more than the plan can keep. */
export const DRIVE_MARGIN = 1.15;
export const MAX_CANDIDATES = 24;

const PLANS: Record<Pace, { title: string; blurb: string; perDay: number; driveHours: number }> = {
  relaxed: { title: "Relaxed", blurb: "Fewer stops, short drives, time to enjoy each place", perDay: 2, driveHours: 3 },
  balanced: { title: "Balanced", blurb: "A good mix: the best places without rushing", perDay: 3, driveHours: 4 },
  packed: { title: "Most places", blurb: "See as much as the days allow", perDay: 4, driveHours: 5 },
};

/** What a kind of place usually asks of the body. A basis for wording, never a claim about one particular place. */
export const EFFORT: Record<ExploreCategoryId, Effort> = { temple: "easy", museum: "easy", lake: "easy", heritage: "easy", beach: "easy", viewpoint: "easy", fort: "moderate", waterfall: "moderate", wildlife: "moderate", peak: "climb" };

const HUB_KINDS = new Set(["city", "town", "district", "subdistrict", "locality", "village"]);
/**
 * States small enough to plan round their middle (a 50 km circle covers most of them). A big state (Karnataka, Maharashtra) is not a
 * "place": naming it means "somewhere in it", or "on the road through it", so it never becomes the hub.
 */
const SMALL_STATES = new Set(["goa", "sikkim", "puducherry", "pondicherry", "delhi", "nct of delhi", "chandigarh"]);
const stateKey = (name: string) => normalizeName(name).replace(/^(state|union territory|ut) of /, "");
const isHubKind = (p: { kind: string; name: string }) => HUB_KINDS.has(p.kind) || (p.kind === "state" && SMALL_STATES.has(stateKey(p.name)));
/** The place to plan round: the first town, city or small state, when the traveller named at most one real sight. */
export function findHub<T extends { place: { kind: string; lat: number; lng: number; name: string } | null; status: string }>(places: T[]): (Hub & { index: number }) | null {
  const usable = places.map((p, index) => ({ p, index })).filter((x) => x.p.place && x.p.status !== "missing");
  const sights = usable.filter((x) => !isHubKind(x.p.place!) && x.p.place!.kind !== "state");
  if (sights.length > 1) return null;                                    // they already know where to go
  const hub = usable.find((x) => isHubKind(x.p.place!));
  return hub ? { lat: hub.p.place!.lat, lng: hub.p.place!.lng, name: hub.p.place!.name, index: hub.index } : null;
}

export const placeKindFor = (c: ExploreCategoryId): "sight" | "water" | "coast" | "hill" | "place" =>
  c === "waterfall" || c === "lake" ? "water" : c === "beach" ? "coast" : c === "peak" || c === "viewpoint" ? "hill" : c === "temple" || c === "fort" || c === "heritage" || c === "museum" ? "sight" : "place";

/** The trip page's own kind of place for an Explore kind, so a stop keeps its icon and its rules once it is saved. */
export const placeCategoryFor = (c: ExploreCategoryId): PlaceCategory =>
  c === "peak" ? "trek" : c === "heritage" ? "other" : c;

const GROUP_PENALTY: Partial<Record<Group, Partial<Record<Effort, number>>>> = {
  family: { climb: 2, moderate: 0.3 },
  family_kids: { climb: 3, moderate: 0.5 },
  family_elders: { climb: 4, moderate: 1.2 },
};
const gentle = (g: Group | null) => g === "family_elders";

const round1 = (n: number) => Math.round(n * 10) / 10;
const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

export type Cand = { item: ExploreItem; km: number; score: number; effort: Effort; interest: Interest | null };

/** The places worth considering, best first. Drops the hub itself, duplicates, and unremarkable common kinds. */
export function candidatesFor(items: ExploreItem[], ask: Ask): Cand[] {
  const seen = new Set<string>();
  const out: Cand[] = [];
  for (const it of items) {
    const km = distanceKm(ask.hub, it);
    if (km > SEARCH_RADIUS_KM + 2) continue;
    const n = normalizeName(it.name);
    if (!n || seen.has(n) || (n === normalizeName(ask.hub.name) && km < 5)) continue;
    const heavy = exploreCategory(it.category)?.heavy ?? true;
    if (heavy && !it.notable) continue;                                  // every shrine and pond is on the map: only the notable ones are worth a plan
    const effort = EFFORT[it.category];
    if (gentle(ask.group) && effort === "climb") continue;                // never put a climb in front of elders
    const interest = ask.interests.find((i) => (INTEREST_KINDS[i] ?? []).includes(it.category)) ?? null;
    const score = (it.notable ? 3 : 0) + (it.heritage ? 1 : 0) + (interest ? 1.5 : 0) - (GROUP_PENALTY[ask.group ?? "solo"]?.[effort] ?? 0) - km / 8;
    seen.add(n);
    out.push({ item: it, km, score, effort, interest });
  }
  // Best first; a kind may not fill more than half the list (a trip of five shrines is not a trip).
  const sorted = out.sort((a, b) => b.score - a.score || a.km - b.km || a.item.name.localeCompare(b.item.name));
  const cap = Math.ceil(MAX_CANDIDATES * 0.5), per = new Map<string, number>();
  const first: Cand[] = [], rest: Cand[] = [];
  for (const c of sorted) { const k = per.get(c.item.category) ?? 0; if (k < cap) { per.set(c.item.category, k + 1); first.push(c); } else rest.push(c); }
  return [...first, ...rest].slice(0, MAX_CANDIDATES);
}

function whyFor(c: Cand, ask: Ask, min: number, basis: Pick["basis"]): string[] {
  const out = [`${round1(c.km)} km from ${ask.hub.name} · about ${hm(min)} by road${basis === "estimate" ? " (estimated)" : ""}`];
  if (c.item.heritage) out.push("Listed as a heritage site on the map");
  else if (c.item.notable) out.push("Well known: it has a Wikipedia or Wikidata entry");
  else out.push("Named on the map; no Wikipedia entry, so check reviews first");
  if (c.interest) out.push(`Matches your interest: ${INTEREST_LABEL[c.interest]}`);
  if (c.effort === "climb") out.push("A climb: tiring for elders or small children");
  else if (c.effort === "moderate" && ask.group && ask.group !== "friends" && ask.group !== "solo" && ask.group !== "couple") out.push("Usually a walk to reach it: fine for most families, slow for elders");
  return out.slice(0, 4);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Split picks into `k` groups by where they are (farthest-first seeds, a few rounds of "nearest centre"), then even out the sizes. */
export function clusterByPlace(pts: { lat: number; lng: number }[], k: number, maxSize: number): number[][] {
  const n = pts.length;
  if (n === 0) return [];
  k = Math.max(1, Math.min(k, n));
  const centres = [0];
  while (centres.length < k) {
    let far = -1, farD = -1;
    for (let i = 0; i < n; i++) { const d = Math.min(...centres.map((c) => distanceKm(pts[i], pts[c]))); if (d > farD) { farD = d; far = i; } }
    centres.push(far);
  }
  let cs = centres.map((i) => ({ lat: pts[i].lat, lng: pts[i].lng }));
  let groups: number[][] = [];
  for (let round = 0; round < 6; round++) {
    groups = cs.map(() => []);
    for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; cs.forEach((c, ci) => { const d = distanceKm(pts[i], c); if (d < bd) { bd = d; b = ci; } }); groups[b].push(i); }
    cs = cs.map((c, ci) => (groups[ci].length ? { lat: mean(groups[ci].map((i) => pts[i].lat)), lng: mean(groups[ci].map((i) => pts[i].lng)) } : c));
  }
  // Even out: a group over its limit gives its farthest-from-centre members to the nearest group with room.
  for (let ci = 0; ci < groups.length; ci++) {
    while (groups[ci].length > maxSize) {
      const worst = [...groups[ci]].sort((a, b) => distanceKm(pts[b], cs[ci]) - distanceKm(pts[a], cs[ci]))[0];
      const target = groups.map((g, gi) => ({ gi, g })).filter((x) => x.gi !== ci && x.g.length < maxSize).sort((a, b) => distanceKm(pts[worst], cs[a.gi]) - distanceKm(pts[worst], cs[b.gi]))[0];
      if (!target) break;
      groups[ci] = groups[ci].filter((i) => i !== worst); groups[target.gi].push(worst);
    }
  }
  return groups.filter((g) => g.length);
}

/**
 * Three plans from the candidates. `matrix`: index 0 is the hub, then `cands` in order; seconds and metres, by road or estimated.
 * Each day is a round trip from the hub (the traveller sleeps at the hub), its stops in the best driving order, and must fit the
 * plan's driving limit: the least valuable stop of an over-long day is dropped, and the plan says so.
 */
export function buildPlans(cands: Cand[], matrix: Matrix, ask: Ask): ProposedPlan[] {
  const basis: Pick["basis"] = matrix.source === "estimate" ? "estimate" : "road";
  const days = Math.max(1, Math.min(ask.days, 10));
  const toPick = (c: Cand, i: number): Pick => {
    const min = Math.round((matrix.durations[0][i + 1] / 60) * DRIVE_MARGIN);
    return { id: exploreRef(c.item), name: c.item.name, lat: c.item.lat, lng: c.item.lng, category: c.item.category, hubKm: round1(matrix.distances[0][i + 1] / 1000 || c.km), hubMin: min, basis, effort: c.effort, notable: c.item.notable, hours: c.item.hours, wikipedia: c.item.wikipedia, why: whyFor(c, ask, min, basis), source: sourceLabel(c.item) };
  };
  const all = cands.map(toPick);
  const order: PlanId[] = ["relaxed", "balanced", "packed"];
  return order.map((id) => {
    const spec = PLANS[id];
    const perDay = gentle(ask.group) && id !== "relaxed" ? Math.min(spec.perDay, 3) : spec.perDay;
    const limitMin = Math.round((ask.maxDriveHours ?? spec.driveHours) * 60);
    const want = Math.min(cands.length, perDay * days);
    // Keep the best `want`, but never a place whose round trip alone breaks the day's driving limit.
    const idx = cands.map((_, i) => i).filter((i) => all[i].hubMin * 2 <= limitMin).slice(0, want);
    const groups = clusterByPlace(idx.map((i) => all[i]), days, perDay);
    const notes: string[] = [];
    const planDays: PlanDay[] = groups.map((g) => {
      let members = g.map((gi) => idx[gi]);
      const driveOf = (m: number[]) => {
        if (m.length === 0) return { order: [] as number[], min: 0 };
        const nodes = m.map((c) => c + 1);
        const d = matrix.durations;
        const order = optimizeOpenPath({ nodes, start: 0, d, end: 0 });
        let sec = 0, prev = 0;
        for (const n of order) { sec += d[prev][n]; prev = n; }
        sec += d[prev][0];
        return { order, min: Math.round((sec / 60) * DRIVE_MARGIN) };
      };
      let r = driveOf(members);
      while (members.length > 1 && r.min > limitMin) {
        const drop = [...members].sort((a, b) => cands[a].score - cands[b].score)[0];
        notes.push(`Left out ${cands[drop].item.name}: it would make a day's driving longer than ${hm(limitMin)}.`);
        members = members.filter((x) => x !== drop);
        r = driveOf(members);
      }
      const picks = r.order.map((n) => all[n - 1]);
      // Say which stops pair well: near each other, so the day is not two long drives.
      for (const p of picks) {
        const buddy = picks.find((q) => q !== p && distanceKm(p, q) <= 12);
        if (buddy && p.why.length < 4) p.why = [...p.why, `Only ${round1(distanceKm(p, buddy))} km from ${buddy.name}, so they pair well`];
      }
      return { day: 0, title: "", picks, driveMin: r.min };
    }).filter((d) => d.picks.length);
    // Nearest days first (an easy start), and each day is named after its best-known stop.
    planDays.sort((a, b) => mean(a.picks.map((p) => p.hubKm)) - mean(b.picks.map((p) => p.hubKm)));
    planDays.forEach((d, i) => {
      d.day = i + 1;
      const star = [...d.picks].sort((a, b) => Number(b.notable) - Number(a.notable) || a.hubKm - b.hubKm)[0];
      d.title = `Day ${d.day} · ${star.name}${d.picks.length > 1 ? ` and ${d.picks.length - 1} more` : ""}`;
    });
    if (planDays.length < days && cands.length > 0) notes.push(`Only ${planDays.length} ${planDays.length === 1 ? "day" : "days"} of well-known places within ${SEARCH_RADIUS_KM} km of ${ask.hub.name}. Add more from the search below.`);
    const count = planDays.reduce((s, d) => s + d.picks.length, 0);
    return { id, title: spec.title, blurb: spec.blurb, days: planDays, count, driveMin: planDays.reduce((s, d) => s + d.driveMin, 0), notes: [...new Set(notes)].slice(0, 3) };
  });
}
