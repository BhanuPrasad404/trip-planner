// From "names the traveller wrote" to real places, each with an honest confidence:
//   sure    — one clear match (or several, but the trip's area clearly picks one)
//   check   — several places share the name, it is very far from the rest, it is a whole state, it was found under another
//             name, or only a near spelling was found. The reason is said in words, with up to 4 alternatives (district + distance).
//   missing — nothing real was found: the traveller searches for it. Never a guessed pin.
// Our own India index answers first (free). OpenStreetMap (Photon) is asked when the index has nothing, or has only a weaker match for a
// named sight ("Ramappa temple"), counted against the daily limit.
import { distanceKm } from "@/lib/geo";
import { FAR_PIN_KM } from "@/lib/pin-check";
import { coreName, findNamed, suffixType, withinEdits, type GeoIndex, type NamedHit } from "@/lib/places/geo-index";
import { normalizeName, type PlaceHit } from "@/lib/places/types";
import type { SaidPlace } from "./types";

export type Option = PlaceHit & { km: number | null; calledAs: string | null };
export type PlaceMatch = SaidPlace & {
  status: "sure" | "check" | "missing";
  /** Why it needs checking (null when sure). */
  reason: string | null;
  place: Option | null;
  alternatives: Option[];
};

export type ResolveDeps = {
  index: () => Promise<GeoIndex | null>;
  /** OpenStreetMap search for names our index doesn't know. Throws when busy. */
  photon: (q: string, near: { lat: number; lng: number } | null) => Promise<PlaceHit[]>;
  /** Counts one outside call against the visitor's daily limit; false = limit reached. */
  allow: () => Promise<boolean>;
};

/** A place this far from the trip's start is worth a second look (a wrong state is the usual cause). */
export const FAR_FROM_START_KM = 1200;
/** The nearest of several same-name places is "clearly" the one when the next is at least this many times farther. */
export const CLEAR_WINNER = 3;
/**
 * When only the START is known (no other places to show where the trip goes), being nearer the start settles a same-name choice only
 * for a place within a day's drive: from Hyderabad, the Manali in Chennai (520 km) is not "clearly" the Manali meant over the one in
 * Himachal (1,650 km). Beyond this, we ask.
 */
export const START_ONLY_CLEAR_KM = 250;
/** Two points this close with the same name are one place (a cave and its entrance, a temple and its car park). */
export const SAME_SPOT_KM = 5;
const MAX_NAMES = 15;
const isLatin = (s: string) => /^[\x20-\x7e]+$/.test(s);

const kmText = (km: number) => `${km.toLocaleString("en-IN")} km`;

/** Does the map's name really name what was written? exact core words · loose: all written words in it, or one letter off. */
export function namesMatch(said: string, name: string): "exact" | "loose" | null {
  const a = coreName(said), b = coreName(name);
  if (!a || !b) return null;
  const sa = suffixType(said), sb = suffixType(name);
  if (sa && sb && sa !== sb) return null; // a temple is not a lake
  if (a === b) return "exact";
  const words = new Set(normalizeName(name).split(" "));
  if (a.split(" ").every((w) => words.has(w))) return "loose";
  return a.length >= 6 && withinEdits(a, b, a.length >= 10 ? 2 : 1) ? "loose" : null; // "Bogatha" / "Boghatha"
}

/** Where does the trip start? The first written guess that is a real town wins. */
export async function resolveStart(candidates: string[], deps: Pick<ResolveDeps, "index">): Promise<{ place: Option | null; alternatives: Option[] }> {
  const ix = await deps.index();
  if (!ix) return { place: null, alternatives: [] };
  for (const c of candidates) {
    const found = findNamed(ix, c, { kinds: ["city", "town", "district", "subdistrict", "locality", "state"], limit: 5 });
    if (found.length) return { place: found[0], alternatives: found.slice(1, 5) };
  }
  return { place: null, alternatives: [] };
}

const fromPhoton = (h: PlaceHit, near: { lat: number; lng: number } | null): Option => ({ ...h, km: near ? Math.round(distanceKm(near, h)) : null, calledAs: null });

/** Same name, a few km apart: one place (keep the first). */
function oneEach<T extends { lat: number; lng: number }>(xs: T[]): T[] {
  const out: T[] = [];
  for (const x of xs) if (!out.some((o) => distanceKm(o, x) < SAME_SPOT_KM)) out.push(x);
  return out;
}

export async function resolvePlaces(said: SaidPlace[], ctx: { start: { lat: number; lng: number; name: string } | null }, deps: ResolveDeps): Promise<PlaceMatch[]> {
  const ix = await deps.index();
  const start = ctx.start;
  const found: (PlaceMatch & { tier: number; loose: boolean })[] = [];
  let limitHit = false;
  let busy = false;

  for (const p of said.slice(0, MAX_NAMES)) {
    const named: NamedHit[] = ix ? findNamed(ix, p.said, { near: start, limit: 6 }) : [];
    let options: Option[] = named;
    let tier = named[0]?.tier ?? 9;
    let loose = false;
    // Ask the map when our list has nothing, or only another-name / district match for what is clearly a sight ("Ramappa temple").
    const wantsMap = normalizeName(p.said).length >= 3 && (named.length === 0 || (tier > 0 && suffixType(p.said) !== null));
    if (wantsMap && !limitHit) {
      if (await deps.allow()) {
        try {
          const hits = oneEach(await deps.photon(p.said, start));
          const exact = hits.filter((h) => namesMatch(p.said, h.name) === "exact");
          const near = hits.filter((h) => namesMatch(p.said, h.name) === "loose");
          if (exact.length) { options = exact.map((h) => fromPhoton(h, start)); tier = 0; }
          else if (named.length === 0 && near.length) { options = near.map((h) => fromPhoton(h, start)); tier = 0; loose = true; }
        } catch { busy = true; /* keep what our list had; say the map was busy, not that the place doesn't exist */ }
      } else limitHit = true;
    }
    if (options.length === 0) {
      // Pieces in an Indian script that match nothing are almost always grammar ("போகணும்" = want to go), not places: don't list them.
      if (p.source === "said" && !isLatin(p.said)) continue;
      found.push({ ...p, status: "missing", tier: 9, loose: false, place: null, alternatives: [],
        reason: limitHit ? `Today's map-search limit is used up, so “${p.said}” wasn't looked up. Search for it.`
          : busy ? `The map search is busy right now, so we couldn't look up “${p.said}”. Search for it, or try again in a minute.`
            : `We couldn't find “${p.said}” on the map. Search for it.` });
      busy = false;
      continue;
    }
    busy = false;
    // The traveller wrote their start city among the places (the AI often lists it too): it is the start, not a stop.
    if (start && options[0] && coreName(options[0].name) === coreName(start.name) && distanceKm(start, options[0]) < 25) continue;
    // Who counts as "the same name": the best tier, plus towns found under another name when the best is only a hill, a
    // locality or water ("Kondapalli" the hill vs Kondapalle the town, also called Kondapalli).
    const tierOf = (o: Option) => (o as NamedHit).tier ?? tier;
    const topTier = tierOf(options[0]);
    const weakTop = !["city", "town", "state", "sight", "district"].includes(options[0].kind);
    const best = options.filter((o) => tierOf(o) === topTier || (weakTop && tierOf(o) === 1 && ["city", "town", "village"].includes(o.kind)));
    const rest = options.filter((o) => !best.includes(o));
    found.push({ ...p, status: "sure", reason: null, tier, loose, place: best[0], alternatives: [...best.slice(1), ...rest].slice(0, 4), sameName: best.length } as PlaceMatch & { tier: number; loose: boolean; sameName: number });
  }

  // Now that we know roughly where the trip goes: choose between same-name places by the trip's area, and flag what needs a second look.
  const anchor = (me: PlaceMatch): { lat: number; lng: number; label: string } | null => {
    const others = found.filter((o) => o !== me && o.place && o.alternatives.length === 0 && !o.loose).map((o) => o.place!);
    if (others.length >= 2) return { lat: med(others.map((o) => o.lat)), lng: med(others.map((o) => o.lng)), label: "your other places" };
    return start ? { ...start, label: start.name } : null;
  };
  for (const m of found) {
    if (!m.place) continue;
    const a = anchor(m);
    const sameName = (m as PlaceMatch & { sameName?: number }).sameName ?? 1;
    const sameTier = [m.place, ...m.alternatives.slice(0, Math.max(0, sameName - 1))];
    if (sameTier.length > 1) {
      const ranked = sameTier.map((o) => ({ o, km: a ? distanceKm(a, o) : null })).sort((x, y) => (x.km ?? 0) - (y.km ?? 0));
      const [best, next] = ranked;
      m.place = { ...best.o, km: best.km === null ? null : Math.round(best.km) };
      m.alternatives = [...ranked.slice(1).map((r) => ({ ...r.o, km: r.km === null ? null : Math.round(r.km) })), ...m.alternatives.filter((x) => !sameTier.includes(x))].slice(0, 4);
      const startOnly = a?.label !== "your other places";
      const clear = best.km !== null && next.km !== null && next.km >= Math.max(1, best.km) * CLEAR_WINNER && (!startOnly || best.km <= START_ONLY_CLEAR_KM);
      if (!clear) { m.status = "check"; m.reason = `${sameTier.length} places are called “${m.place.name}”. Is it the one in ${m.place.area || "this area"}?`; continue; }
    }
    if (m.loose) { m.status = "check"; m.reason = `Closest match on the map: “${m.place.name}”. Is it what you meant by “${m.said}”?`; continue; }
    if (m.place.kind === "state") { m.status = "check"; m.reason = `${m.place.name} is a whole state. Keep it to plan around it, or add the places you want to see there.`; continue; }
    // Found under another name: fine when it's only a spelling ("Lonavala"/"Lonavla", "Srisailam"/"Srisailain") or an Indian-script
    // name; worth a look when the names really differ.
    const spelling = m.place.calledAs && (!isLatin(m.place.calledAs) || withinEdits(normalizeName(m.place.calledAs), normalizeName(m.place.name), 2));
    if (m.place.calledAs && !spelling && m.place.kind !== "city") { m.status = "check"; m.reason = `Listed on the map as “${m.place.name}” (also called ${m.place.calledAs}). Is it the right place?`; continue; }
    const farFromOthers = a && a.label === "your other places" && distanceKm(a, m.place) > FAR_PIN_KM;
    const farFromStart = start && distanceKm(start, m.place) > FAR_FROM_START_KM;
    if (farFromOthers || farFromStart) {
      m.status = "check";
      m.reason = farFromOthers ? `${kmText(Math.round(distanceKm(a!, m.place)))} from your other places. Is it the right one?` : `${kmText(Math.round(distanceKm(start!, m.place)))} from ${start!.name}. Is it the right one?`;
    }
  }
  return found.map((x) => { const { tier: _t, loose: _l, sameName: _s, ...m } = x as typeof x & { sameName?: number }; void _t; void _l; void _s; return m; });
}

function med(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; }
