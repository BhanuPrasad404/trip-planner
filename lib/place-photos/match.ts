// Is this Wikipedia page ABOUT this place? Identity first, photo second.
// A photo is shown only when the page's title is the place's name AND the page sits next to where we located the place.
// Anything weaker gets no photo (the UI shows the category icon) — a wrong picture is worse than none.
import { distanceKm, type GeoPoint } from "@/lib/geo";

/** Words that name a KIND of place, mapped to one canonical form ("waterfall"/"falls" are the same kind; "temple"/"fort" are not). */
const TYPE: Record<string, string> = {
  temple: "temple", mandir: "temple", devasthanam: "temple", fort: "fort", qila: "fort",
  falls: "falls", waterfall: "falls", waterfalls: "falls", cave: "cave", caves: "cave", gufa: "cave",
  beach: "beach", lake: "lake", hill: "hill", hills: "hill", point: "viewpoint", viewpoint: "viewpoint",
  park: "park", garden: "park", gardens: "park", museum: "museum", palace: "palace", dam: "dam", reservoir: "dam",
  island: "island", bridge: "bridge", church: "church", mosque: "mosque", masjid: "mosque", dargah: "mosque",
  ghat: "ghat", valley: "valley", sanctuary: "sanctuary", zoo: "zoo", stupa: "stupa", monastery: "monastery",
  // Everyday amenities: these name a CATEGORY ("Restroom", "Hotel"), never one particular place on their own.
  restroom: "restroom", toilet: "restroom", toilets: "restroom", washroom: "restroom", parking: "parking",
  hotel: "hotel", lodge: "hotel", resort: "hotel", inn: "hotel", guesthouse: "hotel", homestay: "hotel",
  restaurant: "food", dhaba: "food", cafe: "food", canteen: "food", hospital: "hospital", clinic: "hospital",
  pharmacy: "pharmacy", medical: "pharmacy", atm: "bank", bank: "bank", petrol: "fuel", pump: "fuel", fuel: "fuel", bunk: "fuel",
  station: "station", stand: "station", market: "market",
};
const FILLER = new Set(["the", "of", "and", "a", "an", "in", "at", "near", "sri", "shri", "sree", "shree", "swami", "view", "national"]);

export type Identity = { sig: Set<string>; types: Set<string> };

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function identity(raw: string): Identity {
  const text = fold(raw.replace(/\([^)]*\)/g, " ")).replace(/[^a-z0-9]+/g, " ").trim();
  const sig = new Set<string>();
  const types = new Set<string>();
  for (const t of text.split(" ")) {
    if (!t) continue;
    if (TYPE[t]) types.add(TYPE[t]);
    else if (!FILLER.has(t)) sig.add(t);
  }
  return { sig, types };
}

export type NameMatch = { score: number; /** The place names a kind (fort, temple…) but the page title is just the bare name (e.g. the village). */ bareTitle: boolean };

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));

/** null = not the same place. */
export function matchTitle(placeName: string, pageTitle: string): NameMatch | null {
  if (/disambiguation|^list of |^index of /i.test(pageTitle)) return null;
  const a = identity(placeName);
  const b = identity(pageTitle);
  if (a.sig.size === 0 || b.sig.size === 0) return null; // "Restroom", "Beach", "Temple" alone identify nothing
  const [small, large] = a.sig.size <= b.sig.size ? [a.sig, b.sig] : [b.sig, a.sig];
  if (!isSubset(small, large)) return null;
  if (small.size === 1 && [...small][0].length < 4) return null; // "Om", "Ram": too short to trust
  if (a.types.size > 0 && b.types.size > 0 && ![...a.types].some((t) => b.types.has(t))) return null; // a temple is not the fort next to it
  const sameSig = a.sig.size === b.sig.size;
  const bareTitle = a.types.size > 0 && b.types.size === 0;
  return { score: (sameSig ? 2 : 1.5) - (bareTitle ? 0.5 : 0), bareTitle };
}

export type PageCandidate = { title: string; lat: number; lng: number; thumb: { url: string; width: number; height: number } | null };

export const MAX_MATCH_KM = 3;
/** A bare page ("Kondapalli") only counts for "Kondapalli Fort" when it is practically the same spot. */
export const BARE_TITLE_MAX_KM = 0.6;

/** The one page that is this place, or null. */
export function pickPage(place: { name: string } & GeoPoint, candidates: PageCandidate[]): PageCandidate | null {
  let best: { c: PageCandidate; score: number; km: number } | null = null;
  for (const c of candidates) {
    if (!c.thumb) continue;
    const m = matchTitle(place.name, c.title);
    if (!m) continue;
    const km = distanceKm(place, c);
    if (km > MAX_MATCH_KM || (m.bareTitle && km > BARE_TITLE_MAX_KM)) continue;
    if (!best || m.score > best.score || (m.score === best.score && km < best.km)) best = { c, score: m.score, km };
  }
  return best?.c ?? null;
}
