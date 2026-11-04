// "About this place": what is worth knowing about a location, from real sources only.
//   1. A Wikipedia write-up of THE place: found from the place's own Wikipedia link, or its Wikidata entry, or (last) by searching Wikipedia
//      near its coordinates and accepting a page only when its title AND its position both agree with the place (lib/place-photos/match.ts,
//      the same rule the photos use). A page about a different place with a similar name is never shown.
//   2. A few GENERAL tips for that kind of place (a temple, a beach, a waterfall…), clearly labelled as general, never as facts about this one.
// Nothing is made up: with no write-up the answer says so and offers only what we really hold (kind, heritage listing, hours, website).
import { AsyncCache } from "@/lib/cache";
import { pickIdentity } from "@/lib/place-photos/match";
import type { ExploreCategoryId } from "@/lib/explore/categories";

export type AboutQuery = { name: string; lat: number; lng: number; wikipedia?: string | null; wikidata?: string | null };
export type AboutArticle = { title: string; /** A short description ("17th-century fort in Hyderabad"). */ description: string | null; paragraphs: string[]; url: string; source: "Wikipedia"; licence: "CC BY-SA 4.0" };
export type AboutAnswer = { article: AboutArticle | null; /** The lookup itself failed (the service could not be reached): worth trying again. */ unavailable: boolean };
export type Getter = (url: string) => Promise<unknown>;

const WIKI = "https://en.wikipedia.org";
const QID = /^Q\d{1,12}$/;

/** The page title in an English Wikipedia link, or null for anything else (another site, another language, a malformed link). */
export function titleFromWikipediaUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== "en.wikipedia.org" || !u.pathname.startsWith("/wiki/")) return null;
    const t = decodeURIComponent(u.pathname.slice(6)).replace(/_/g, " ").trim();
    return t && t.length <= 200 ? t : null;
  } catch { return null; }
}

/** At most ~`max` characters, ending at a sentence end. */
export function clip(text: string, max = 900): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

type Summary = { type?: string; title?: string; description?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };

/** A Wikipedia summary read as an article, or null when it is a disambiguation page, empty, or not an article. */
export function articleFrom(json: unknown): AboutArticle | null {
  const s = (json ?? {}) as Summary;
  if (s.type !== "standard" || typeof s.title !== "string" || typeof s.extract !== "string" || s.extract.trim().length < 40) return null;
  const url = s.content_urls?.desktop?.page;
  if (typeof url !== "string" || titleFromWikipediaUrl(url) === null) return null;
  const text = clip(s.extract);
  // The summary is a few sentences; split into short paragraphs at about every 2 sentences so a phone screen is easy to read.
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) paragraphs.push(sentences.slice(i, i + 2).join(" "));
  return { title: s.title, description: typeof s.description === "string" && s.description.trim() ? s.description.trim().slice(0, 160) : null, paragraphs, url, source: "Wikipedia", licence: "CC BY-SA 4.0" };
}

async function titleFor(q: AboutQuery, get: Getter): Promise<string | null> {
  const direct = titleFromWikipediaUrl(q.wikipedia);
  if (direct) return direct;
  if (q.wikidata && QID.test(q.wikidata)) {
    const j = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q.wikidata}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`) as { entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }> };
    const t = j?.entities?.[q.wikidata]?.sitelinks?.enwiki?.title;
    if (typeof t === "string" && t) return t;
  }
  const g = await get(`${WIKI}/w/api.php?action=query&list=geosearch&gscoord=${q.lat.toFixed(5)}%7C${q.lng.toFixed(5)}&gsradius=3000&gslimit=15&format=json&origin=*`) as { query?: { geosearch?: { title?: string; lat?: number; lon?: number }[] } };
  const cands = (g?.query?.geosearch ?? []).filter((c): c is { title: string; lat: number; lon: number } => typeof c.title === "string" && Number.isFinite(c.lat) && Number.isFinite(c.lon)).map((c) => ({ title: c.title, lat: c.lat, lng: c.lon }));
  return pickIdentity({ name: q.name, lat: q.lat, lng: q.lng }, cands)?.title ?? null;
}

/** The write-up for a place, or `{ article: null }` when there is none (or `unavailable` when the service could not be reached). Never throws. */
export async function lookupAbout(q: AboutQuery, get: Getter): Promise<AboutAnswer> {
  try {
    const title = await titleFor(q, get);
    if (!title) return { article: null, unavailable: false };
    const json = await get(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    return { article: articleFrom(json), unavailable: false };
  } catch (e) {
    // A page that does not exist is an honest "nothing"; anything else is the service being away.
    return { article: null, unavailable: !(e instanceof NotFound) };
  }
}
export class NotFound extends Error {}

const defaultGet: Getter = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)", Accept: "application/json" }, signal: AbortSignal.timeout(6000), next: { revalidate: 86_400 } } as RequestInit);
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const cache = new AsyncCache<AboutAnswer>({ name: "place-about", max: 600, ttlMs: (v) => (v.unavailable ? 60_000 : v.article ? 7 * 24 * 3_600_000 : 24 * 3_600_000) });
export const aboutKey = (q: AboutQuery) => `${q.name.toLowerCase().slice(0, 80)}|${q.lat.toFixed(3)},${q.lng.toFixed(3)}|${q.wikidata ?? ""}|${titleFromWikipediaUrl(q.wikipedia) ?? ""}`;
export const aboutFor = (q: AboutQuery, get: Getter = defaultGet): Promise<AboutAnswer> => cache.get(aboutKey(q), () => lookupAbout(q, get));

// ── General tips by kind of place ──
export type Tips = { heading: string; items: string[] };
const TIPS: Record<ExploreCategoryId, string[]> = {
  temple: ["Footwear is usually taken off at the entrance, so wear something easy to slip off.", "Dress modestly (shoulders and knees covered) and check the darshan and closing times locally; many close in the afternoon.", "Photography is often not allowed inside the main shrine."],
  fort: ["Expect stairs, slopes and uneven stone, so wear shoes with grip.", "Carry water: there is often little shade or shopping inside.", "Go early or late in the day to avoid the midday heat."],
  waterfall: ["Rocks near the water are slippery; stay behind any barriers.", "Heavy rain upstream can flood a stream quickly, so avoid going in after a downpour.", "The flow is strongest in and after the rains and can be thin in the dry months."],
  beach: ["Swim only where signs or lifeguards say it is safe; currents can be strong.", "Check the weather and tide before you go, and keep valuables out of sight.", "Carry sun protection and water."],
  wildlife: ["Entry fees, safari slots and closing days vary, so check with the park before you travel.", "Early morning and late afternoon are usually best for seeing animals.", "Keep to the marked paths and never feed animals."],
  lake: ["Check whether boating or entry is allowed and when, as rules change by season.", "Water levels and views vary a lot between the dry and rainy months.", "Keep to marked areas near the edge."],
  museum: ["Check opening days: many museums close one day a week and on public holidays.", "Ask whether there is a separate fee for cameras.", "Allow an hour or two."],
  viewpoint: ["Views are clearest in the morning and after rain, and poorest in haze or cloud.", "Sunrise and sunset are the best times if the weather is clear.", "Keep away from unfenced edges."],
  heritage: ["Check whether it is ticketed and what the opening hours are.", "Go early to beat the crowds and the heat.", "Wear comfortable shoes: sites often have uneven ground."],
  peak: ["Start early, carry water, and tell someone your plan.", "Weather can change quickly on higher ground.", "Wear shoes with good grip."],
};
const KIND_WORDS: Record<ExploreCategoryId, string> = { temple: "temple visits", fort: "forts", waterfall: "waterfalls", beach: "beaches", wildlife: "wildlife parks", lake: "lakes and dams", museum: "museums", viewpoint: "viewpoints", heritage: "heritage sites", peak: "hills and peaks" };
/** General tips for a kind of place; null for a kind we have none for. They are labelled as general: they are not claims about one particular place. */
export function tipsFor(category: string | null | undefined): Tips | null {
  const c = category as ExploreCategoryId;
  if (!c || !TIPS[c]) return null;
  return { heading: `General tips for ${KIND_WORDS[c]}`, items: TIPS[c] };
}

/** The planner's category of a stop ("hill_station", "trek"…) as the kind of place the tips are written for, or null when there are none. */
export function aboutKindOf(planner: string | null | undefined): ExploreCategoryId | null {
  switch (planner) {
    case "temple": case "fort": case "waterfall": case "beach": case "lake": case "museum": case "viewpoint": case "wildlife": return planner;
    case "hill_station": case "trek": return "peak";
    default: return null;
  }
}
