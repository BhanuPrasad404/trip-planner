// "About this place": the write-up must be about THIS place (name and position), credited, never invented; general tips are labelled general;
// a failed lookup says so instead of pretending there is nothing to know.
import { createElement } from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aboutKindOf, articleFrom, clip, lookupAbout, NotFound, tipsFor, titleFromWikipediaUrl, type Getter } from "@/lib/place-about";
import { placeAboutSchema } from "@/lib/validation/schemas";
import { AboutPlace } from "@/components/place/AboutPlace";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/ui/Sheet", async () => { const { createElement: h } = await import("react"); return { PICKER_BUTTON: "picker-button", PickerSheet: ({ title, children, footer }: { title: string; children: unknown; footer?: unknown }) => h("div", { role: "dialog", "aria-label": title }, children as never, footer as never) }; });

const SUMMARY = { type: "standard", title: "Golconda Fort", description: "Fortress in Hyderabad, Telangana", extract: "Golconda Fort is a fortified citadel and an early capital city of the Qutb Shahi dynasty. It is located in Hyderabad and is known for its acoustics. The fort was built in the 16th century.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Golconda_Fort" } } };
const q = { name: "Golconda Fort", lat: 17.3833, lng: 78.4011 };
const get = (map: Record<string, unknown>): Getter => async (url) => {
  for (const [k, v] of Object.entries(map)) if (url.includes(k)) { if (v instanceof Error) throw v; return v; }
  throw new NotFound();
};

describe("finding the page that is THIS place", () => {
  it("uses the place's own Wikipedia link first", async () => {
    const r = await lookupAbout({ ...q, wikipedia: "https://en.wikipedia.org/wiki/Golconda_Fort" }, get({ "/page/summary/Golconda_Fort": SUMMARY }));
    expect(r.article).toMatchObject({ title: "Golconda Fort", url: "https://en.wikipedia.org/wiki/Golconda_Fort", source: "Wikipedia", licence: "CC BY-SA 4.0", description: "Fortress in Hyderabad, Telangana" });
    expect(r.unavailable).toBe(false);
  });
  it("then its Wikidata entry", async () => {
    const r = await lookupAbout({ ...q, wikidata: "Q1" }, get({ "wbgetentities": { entities: { Q1: { sitelinks: { enwiki: { title: "Golconda Fort" } } } } }, "/page/summary/Golconda_Fort": SUMMARY }));
    expect(r.article?.title).toBe("Golconda Fort");
  });
  it("then a search near its position, accepting a page only when title AND position agree", async () => {
    const g = get({ "list=geosearch": { query: { geosearch: [{ title: "Golconda Fort", lat: 17.3837, lon: 78.4012 }, { title: "Hyderabad", lat: 17.385, lon: 78.4867 }] } }, "/page/summary/Golconda_Fort": SUMMARY });
    expect((await lookupAbout(q, g)).article?.title).toBe("Golconda Fort");
  });
  it("a page about a different place with a similar name, or the right name far away, is never shown", async () => {
    const wrongName = get({ "list=geosearch": { query: { geosearch: [{ title: "Charminar", lat: 17.3837, lon: 78.4012 }] } }, "/page/summary/": SUMMARY });
    expect((await lookupAbout(q, wrongName)).article).toBeNull();
    const farAway = get({ "list=geosearch": { query: { geosearch: [{ title: "Golconda Fort", lat: 12.9, lon: 77.6 }] } }, "/page/summary/": SUMMARY });
    expect((await lookupAbout(q, farAway)).article).toBeNull();
  });
  it("no page at all is an honest 'nothing', not a failure", async () => {
    const r = await lookupAbout(q, get({ "list=geosearch": { query: { geosearch: [] } } }));
    expect(r).toEqual({ article: null, unavailable: false });
    const missing = await lookupAbout({ ...q, wikipedia: "https://en.wikipedia.org/wiki/Nope" }, get({}));
    expect(missing).toEqual({ article: null, unavailable: false });
  });
  it("the service being away is said as such (so the screen offers 'Try again')", async () => {
    expect(await lookupAbout({ ...q, wikipedia: "https://en.wikipedia.org/wiki/Golconda_Fort" }, get({ "/page/summary/": new Error("HTTP 503") }))).toEqual({ article: null, unavailable: true });
  });
  it("a disambiguation page, an empty extract or a link off Wikipedia is not an article", () => {
    expect(articleFrom({ ...SUMMARY, type: "disambiguation" })).toBeNull();
    expect(articleFrom({ ...SUMMARY, extract: "Short." })).toBeNull();
    expect(articleFrom({ ...SUMMARY, content_urls: { desktop: { page: "https://evil.example/wiki/X" } } })).toBeNull();
  });
  it("only English Wikipedia links over https count as the place's own page", () => {
    expect(titleFromWikipediaUrl("https://en.wikipedia.org/wiki/Golconda_Fort")).toBe("Golconda Fort");
    for (const bad of ["http://en.wikipedia.org/wiki/X", "https://de.wikipedia.org/wiki/X", "https://example.com/wiki/X", "javascript:alert(1)", "", null, undefined]) expect(titleFromWikipediaUrl(bad as never)).toBeNull();
  });
  it("is split into short paragraphs and clipped at a sentence end", () => {
    const a = articleFrom(SUMMARY)!;
    expect(a.paragraphs.length).toBeGreaterThanOrEqual(2); expect(a.paragraphs.join(" ")).toContain("early capital city");
    const long = `${"A sentence about the fort. ".repeat(80)}`;
    const c = clip(long, 200); expect(c.length).toBeLessThanOrEqual(200); expect(c.endsWith(".")).toBe(true);
  });
});

describe("general tips are for the KIND of place and say so", () => {
  it("every kind has tips, headed as general, and an unknown kind has none", () => {
    for (const k of ["temple", "fort", "waterfall", "beach", "wildlife", "lake", "museum", "viewpoint", "heritage", "peak"]) { const t = tipsFor(k)!; expect(t.heading).toMatch(/^General tips for/); expect(t.items.length).toBeGreaterThanOrEqual(3); }
    expect(tipsFor("food")).toBeNull(); expect(tipsFor(null)).toBeNull();
  });
  it("a stop's planner category maps to a kind the tips are written for", () => {
    expect(aboutKindOf("hill_station")).toBe("peak"); expect(aboutKindOf("temple")).toBe("temple"); expect(aboutKindOf("food")).toBeNull(); expect(aboutKindOf(null)).toBeNull();
  });
  it("the request is validated: a name, a position, and only a real Wikidata id", () => {
    expect(placeAboutSchema.safeParse({ name: "Golconda Fort", lat: 17.38, lng: 78.4, wikidata: "Q123", category: "fort" }).success).toBe(true);
    expect(placeAboutSchema.safeParse({ name: "", lat: 17.38, lng: 78.4 }).success).toBe(false);
    expect(placeAboutSchema.safeParse({ name: "x", lat: 17.38, lng: 78.4, wikidata: "not-an-id" }).success).toBe(false);
  });
});

describe("the About button and sheet", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const flat = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(flat).join(""));
  let n = 0;
  const place = (o: Record<string, unknown> = {}) => ({ name: `Golconda Fort ${++n}`, lat: 17.3833, lng: 78.4011, category: "fort", ...o });
  const mount = async (p: ReturnType<typeof place>, answer: unknown, status = 200) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(answer), { status })) as unknown as typeof fetch;
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(AboutPlace, { place: p })); });
    await act(async () => { r.root.findByType("button").props.onClick(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    return r;
  };
  beforeEach(() => undefined);
  it("shows what it is, credited and linked, with general tips labelled as general", async () => {
    const r = await mount(place({ heritage: true, hours: "Mo-Su 09:00-17:30", website: "https://example.org/golconda" }), { article: articleFrom(SUMMARY), unavailable: false, tips: tipsFor("fort") });
    const t = flat(r.root);
    expect(t).toContain("early capital city"); expect(t).toContain("From Wikipedia: Golconda Fort"); expect(t).toContain("CC BY-SA 4.0"); expect(t).toContain("Read the full article");
    expect(t).toContain("General tips for forts"); expect(t).toContain("not facts about this one");
    expect(t).toContain("Heritage listed"); expect(t).toContain("Mo-Su 09:00-17:30"); expect(t).toContain("not confirmed"); expect(t).toContain("example.org");
    expect(r.root.findAll((x) => x.type === "a" && x.props.href === "https://en.wikipedia.org/wiki/Golconda_Fort").length).toBeGreaterThanOrEqual(1);
    await act(async () => { r.unmount(); });
  });
  it("with no write-up it says so and still shows what we do hold: it never guesses", async () => {
    const r = await mount(place({ category: "temple" }), { article: null, unavailable: false, tips: tipsFor("temple") });
    const t = flat(r.root);
    expect(t).toContain("We don't have a write-up for this place yet, and we won't guess"); expect(t).toContain("Temples & religious sites"); expect(t).toContain("General tips for temple visits");
    await act(async () => { r.unmount(); });
  });
  it("when the service is away it says so and offers to try again", async () => {
    const r = await mount(place(), { article: null, unavailable: true, tips: null });
    expect(flat(r.root)).toContain("couldn't reach Wikipedia"); expect(flat(r.root)).toContain("Try again");
    await act(async () => { r.unmount(); });
  });
  it("a failed request is shown with a retry, and the sheet can be closed", async () => {
    const r = await mount(place(), { error: "Slow down a little" }, 429);
    expect(flat(r.root)).toContain("Slow down a little");
    expect(r.root.findAll((x) => x.type === "button" && flat(x) === "Close").length).toBe(1);
    await act(async () => { r.unmount(); });
  });
  it("asks for the place by name and position, with its own links when the map has them", async () => {
    const p = place({ wikipedia: "https://en.wikipedia.org/wiki/Golconda_Fort", wikidata: "Q123" });
    const r = await mount(p, { article: null, unavailable: false, tips: null });
    const body = JSON.parse(String((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body));
    expect(body).toMatchObject({ name: p.name, lat: 17.3833, lng: 78.4011, wikipedia: "https://en.wikipedia.org/wiki/Golconda_Fort", wikidata: "Q123", category: "fort" });
    await act(async () => { r.unmount(); });
  });
});
