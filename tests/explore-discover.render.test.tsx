import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { choose, optionsOf } from "./helpers/select";
import { ExploreView, type ExploreSeasonTag } from "@/components/ExploreView";
import { forgetKnownPhotos } from "@/lib/client/use-place-photos";
import { forgetFailedImages } from "@/components/ui/SafeImg";
import type { ExploreItem } from "@/lib/explore/items";
// Explore with a trip shows the trip section, which can send the person to Discover: a router stand-in for these tests.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
type Req = { url: string; method: string; body: Record<string, unknown> | null };
let requests: Req[] = [];
let all: ExploreItem[] = [];
let exploreMode: "ok" | "fail-once" | "fail" | "stale" = "ok";
let savedRows: { place_key: string; name: string; lat: number; lng: number; category: string | null; region: string | null }[] = [];
let saveStatus = 200;
let photos: Record<string, unknown> = {};
let failedOnce = false;

const mk = (n: number, over: (i: number) => Partial<ExploreItem> = () => ({})): ExploreItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `way/${i + 1}`, name: `Fort ${String(i + 1).padStart(2, "0")}`, category: "fort" as const, lat: 17 + i * 0.01, lng: 78, notable: i < 2, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, ...over(i) }));

beforeEach(() => {
  forgetKnownPhotos(); forgetFailedImages(); requests = []; all = mk(40); exploreMode = "ok"; savedRows = []; saveStatus = 200; photos = {}; failedOnce = false;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    requests.push({ url: u, method: init?.method ?? "GET", body });
    if (u === "/api/explore") {
      if (exploreMode === "fail" || (exploreMode === "fail-once" && !failedOnce)) { failedOnce = true; return new Response(JSON.stringify({ error: "The map servers are busy right now. Please try again in a minute." }), { status: 502 }); }
      const b = body as { category: string; cursor: number; limit: number; q?: string };
      let list = b.category === "all" ? all : all.filter((i) => i.category === b.category);
      if (b.q) list = list.filter((i) => i.name.toLowerCase().includes(b.q!.toLowerCase()));
      const items = list.slice(b.cursor, b.cursor + b.limit);
      return new Response(JSON.stringify({ items, total: list.length, nextCursor: b.cursor + b.limit < list.length ? b.cursor + b.limit : null, source: "cache", stale: exploreMode === "stale", fetchedAt: "2026-10-10T00:00:00.000Z" }), { status: 200 });
    }
    if (u === "/api/saved-places") {
      if (init?.method === "POST" || init?.method === "DELETE") return saveStatus === 200 ? new Response("{}", { status: 200 }) : new Response(JSON.stringify({ error: "You can save up to 500 places. Remove one to save another." }), { status: saveStatus });
      return new Response(JSON.stringify({ places: savedRows }), { status: 200 });
    }
    if (u === "/api/place-photos") return new Response(JSON.stringify({ photos, unresolved: [] }), { status: 200 });
    if (u === "/api/places/bulk") return new Response("{}", { status: 200 });
    if (u.startsWith("/api/destinations/suggest")) return new Response(JSON.stringify({ destinations: [] }), { status: 200 });
    if (u === "/api/nearby") return new Response(JSON.stringify({ places: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

const text = (n: ReactTestInstance): string => n.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
const buttons = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === "button" && text(n).includes(label));
const press = async (r: TestRenderer.ReactTestRenderer, label: string, nth = 0) => { const b = buttons(r, label)[nth]; if (!b) throw new Error(`no button "${label}"`); await act(async () => { b.props.onClick(); }); await flush(); };
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const exploreCalls = () => requests.filter((x) => x.url === "/api/explore").map((x) => x.body as Record<string, unknown>);
const cards = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "li" && typeof n.props.className === "string" && n.props.className.includes("rounded-2xl") && text(n).includes("Fort "));

const mount = async (props: Partial<React.ComponentProps<typeof ExploreView>> = {}) => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<ExploreView tripId={null} anchors={[]} seasonTags={[]} month={10} {...props} />, { createNodeMock: () => ({ complete: false, naturalWidth: 0 }) }); });
  await flush();
  return r;
};
const chooseRegion = async (r: TestRenderer.ReactTestRenderer, code = "TG") => {
  await act(async () => { choose(r.root, "explore-region", code); });
  await flush();
};

describe("Discover: nothing is fetched until you choose, then every state works the same way", () => {
  it("with no trip, asks you to choose a state or union territory and fetches nothing yet", async () => {
    const r = await mount();
    expect(text(r.root)).toContain("Choose a state or union territory to see its places.");
    expect(exploreCalls()).toHaveLength(0);
    expect(optionsOf(r.root, "explore-region").length).toBe(36); // 36 states and union territories ("Choose…" is the placeholder)
    expect(buttons(r, "Kerala").length).toBeGreaterThan(0); // quick-pick chips
  });
  it("choosing a state loads its ranked places (first page, 18) and says how many there are", async () => {
    const r = await mount();
    await chooseRegion(r, "KL");
    expect(exploreCalls()).toEqual([{ scope: { kind: "state", code: "KL" }, category: "all", sort: "notable", cursor: 0, limit: 18 }]);
    expect(cards(r)).toHaveLength(18);
    expect(text(r.root)).toContain("Showing 18 of 40 places · Kerala");
    expect(text(r.root)).toContain("Well known"); // the first two are notable
  });
  it("the quick-pick chips do the same as the menu", async () => {
    const r = await mount();
    await press(r, "Goa");
    expect(exploreCalls()[0].scope).toEqual({ kind: "state", code: "GA" });
  });
});

describe("filters, search, sort, paging", () => {
  it("a category chip re-queries from the top; pressing it again goes back to all", async () => {
    all = [...mk(20), ...mk(5, (i) => ({ id: `way/${100 + i}`, name: `Falls ${i + 1}`, category: "waterfall" as const }))];
    const r = await mount(); await chooseRegion(r);
    await press(r, "Waterfalls");
    expect(exploreCalls().at(-1)).toMatchObject({ category: "waterfall", cursor: 0 });
    expect(text(r.root)).toContain("Showing 5 of 5 waterfalls");
    await press(r, "Waterfalls");
    expect(exploreCalls().at(-1)).toMatchObject({ category: "all" });
  });
  it("'Show more places' appends the next page without repeating a place, and disappears at the end", async () => {
    const r = await mount(); await chooseRegion(r);
    await press(r, "Show more places");
    expect(exploreCalls().at(-1)).toMatchObject({ cursor: 18 });
    expect(cards(r)).toHaveLength(36);
    await press(r, "Show more places");
    expect(cards(r)).toHaveLength(40);
    expect(buttons(r, "Show more places")).toHaveLength(0);
    const names = cards(r).map((c) => text(c).match(/Fort \d\d/)![0]);
    expect(new Set(names).size).toBe(40);
  });
  it("if the list shifts between two page requests, a place that now appears again is not shown twice", async () => {
    const r = await mount(); await chooseRegion(r);
    all = [{ ...mk(1)[0], id: "way/999", name: "Fort 99" }, ...all]; // a new place pushes everything down by one
    await press(r, "Show more places");
    const names = cards(r).map((c) => text(c).match(/Fort \d\d/)![0]);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(35); // 18 + (18 - the one already shown)
  });
  it("searching inside the results waits for a pause in typing, then asks once", async () => {
    vi.useFakeTimers();
    const r = await mount(); await chooseRegion(r);
    const input = r.root.findByProps({ id: "explore-q" });
    for (const v of ["F", "Fo", "Fort 0", "Fort 07"]) await act(async () => { input.props.onChange({ target: { value: v } }); await vi.advanceTimersByTimeAsync(100); });
    expect(exploreCalls().filter((c) => c.q)).toHaveLength(0); // still typing
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await flush();
    expect(exploreCalls().filter((c) => c.q)).toEqual([expect.objectContaining({ q: "Fort 07", cursor: 0 })]);
    expect(cards(r)).toHaveLength(1);
  });
  it("offers 'Nearest' only when there is a place to measure from", async () => {
    const without = await mount(); await chooseRegion(without);
    expect(without.root.findByProps({ value: "notable" })).toBeTruthy();
    expect(optionsOf(without.root, "discover-sort").filter((o) => o.value === "nearest")).toHaveLength(0);
    const withTrip = await mount({ tripId: "t1", anchors: [{ id: "dest", label: "Mothkur", lat: 17.5, lng: 78.9 }] });
    await act(async () => { withTrip.root.findAllByType("button").find((b) => text(b) === "By state or UT")!.props.onClick(); });
    await chooseRegion(withTrip);
    expect(optionsOf(withTrip.root, "discover-sort").filter((o) => o.value === "nearest").map((o) => o.label)).toEqual(["Nearest to Mothkur"]);
  });
  it("around a trip's destination it browses that point by default (radius 25 km) with distances", async () => {
    await mount({ tripId: "t1", anchors: [{ id: "dest", label: "Mothkur", lat: 17.5, lng: 78.9 }] });
    expect(exploreCalls()[0]).toMatchObject({ scope: { kind: "point", lat: 17.5, lng: 78.9, radius_km: 25 }, anchor: { lat: 17.5, lng: 78.9 } });
  });
});

describe("honest states", () => {
  it("shows a loading skeleton while the first page is on its way", async () => {
    let release!: () => void; const gate = new Promise<void>((res) => { release = res; });
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: string | URL | Request, i?: RequestInit) => { if (String(u) === "/api/explore") await gate; return (base as typeof fetch)(u, i); }) as unknown as typeof fetch;
    const r = await mount(); await chooseRegion(r);
    expect(r.root.findAll((n) => n.props["aria-label"] === "Loading places")).toHaveLength(1);
    await act(async () => { release(); await Promise.resolve(); }); await flush();
    expect(r.root.findAll((n) => n.props["aria-label"] === "Loading places")).toHaveLength(0);
    expect(cards(r).length).toBe(18);
  });
  it("an error says what happened, shows no places, and 'Try again' recovers", async () => {
    exploreMode = "fail-once";
    const r = await mount(); await chooseRegion(r);
    expect(text(r.root)).toContain("The map servers are busy right now.");
    expect(cards(r)).toHaveLength(0);
    await press(r, "Try again");
    expect(cards(r)).toHaveLength(18);
    expect(text(r.root)).not.toContain("map servers are busy");
  });
  it("an offline device gets a plain message, not a crash", async () => {
    const r = await mount();
    globalThis.fetch = vi.fn(async (u: string | URL | Request) => { if (String(u) === "/api/explore") throw new TypeError("Failed to fetch"); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await chooseRegion(r);
    expect(text(r.root)).toContain("You seem to be offline");
  });
  it("an empty region/category says so and offers a way out", async () => {
    all = [];
    const r = await mount(); await chooseRegion(r, "LD");
    expect(text(r.root)).toContain("No places found in Lakshadweep.");
    all = mk(3, () => ({ category: "waterfall" as const }));
    await press(r, "Beaches");
    expect(text(r.root)).toContain("No beaches found in Lakshadweep.");
    await press(r, "Show everything");
    expect(exploreCalls().at(-1)).toMatchObject({ category: "all" });
  });
  it("tells you when the list is an older saved one because the map servers are busy", async () => {
    exploreMode = "stale";
    const r = await mount(); await chooseRegion(r);
    expect(text(r.root)).toContain("The map servers are busy, so this is the list we saved on");
  });
  it("credits OpenStreetMap, and does not pretend to filter by price or rating", async () => {
    const r = await mount();
    expect(text(r.root)).toContain("© OpenStreetMap contributors (ODbL)");
    expect(text(r.root)).toContain("we don't guess");
  });
});

describe("cards: photos, details, season, map, save, add to trip", () => {
  it("fills in real photos after the cards are on screen, with credit, and leaves the rest with an icon", async () => {
    photos = { "explore-way/1": { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/330px-F.jpg", width: 330, height: 220, title: "Fort 01", pageUrl: "https://en.wikipedia.org/wiki/Fort_01", source: "wikipedia", creditUrl: "https://commons.wikimedia.org/wiki/File:F.jpg", author: "Jane Doe", licence: "CC BY-SA 4.0" } };
    const r = await mount(); await chooseRegion(r);
    const asked = requests.filter((x) => x.url === "/api/place-photos").flatMap((x) => (x.body as { places: { key: string }[] }).places.map((p) => p.key));
    expect(asked).toContain("explore-way/1"); expect(asked).toContain("explore-way/18"); expect(asked).not.toContain("explore-way/19"); // only what is on screen
    expect(r.root.findAllByType("img").map((i) => i.props.alt)).toEqual(["Photo of Fort 01"]);
    expect(text(r.root)).toContain("Photo: Jane Doe, CC BY-SA 4.0");
  });
  it("uses the place's own Wikimedia photo tag when the resolver has nothing, credited to Commons", async () => {
    all = mk(3, (i) => (i === 0 ? { photo: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/330px-X.jpg", source: "osm" as const, creditUrl: "https://commons.wikimedia.org/wiki/File:X.jpg" } } : {}));
    const r = await mount(); await chooseRegion(r);
    expect(r.root.findAllByType("img").map((i) => i.props.alt)).toEqual(["Photo of Fort 01"]);
    expect(text(r.root)).toContain("Photo: Wikimedia Commons");
  });
  it("details open and close, show coordinates, hours as written, links, and are honest about missing season data", async () => {
    all = mk(2, (i) => (i === 0 ? { hours: "Mo-Su 09:00-17:30", website: "https://tourism.example.org", wikipedia: "https://en.wikipedia.org/wiki/Fort_01", wikidata: "Q1", heritage: true } : {}));
    const r = await mount(); await chooseRegion(r);
    expect(text(r.root)).not.toContain("Mo-Su 09:00-17:30");
    await press(r, "Details");
    const t = text(r.root);
    expect(t).toContain("17.0000, 78.0000"); expect(t).toContain("Mo-Su 09:00-17:30"); expect(t).toContain("Heritage listed");
    expect(t).toContain("haven't researched the best months");
    const hrefs = r.root.findAllByType("a").map((a) => a.props.href);
    for (const h of ["https://tourism.example.org", "https://en.wikipedia.org/wiki/Fort_01", "https://www.wikidata.org/wiki/Q1"]) expect(hrefs).toContain(h);
    expect(hrefs.some((h) => String(h).startsWith("https://www.google.com/maps/dir/"))).toBe(true);
    const toggle = buttons(r, "Hide details")[0]; expect(toggle.props["aria-expanded"]).toBe(true);
    await press(r, "Hide details");
    expect(text(r.root)).not.toContain("Mo-Su 09:00-17:30");
  });
  it("every card links to the place on a map, and external links are safe", async () => {
    const r = await mount(); await chooseRegion(r);
    const maps = r.root.findAll((n) => n.type === "a" && String(n.props.href).startsWith("https://www.google.com/maps/search/") && text(n).startsWith("Map"));
    expect(maps).toHaveLength(18);
    for (const a of maps) expect(a.props.rel).toContain("noopener");
  });
  it("marks a place in or out of season ONLY when a researched entry matches it, with the source", async () => {
    all = [{ ...mk(1)[0], id: "way/7", name: "Kondapalli Fort", lat: 16.619, lng: 80.534 }, { ...mk(1)[0], id: "way/8", name: "Some Other Fort", lat: 16.7, lng: 80.6 }];
    const tag: ExploreSeasonTag = { id: "s1", place_name: "Kondapalli Fort", lat: 16.619, lng: 80.534, category: "fort", good_months: [10, 11, 12, 1, 2], reason: "Cool and dry", region: "Andhra Pradesh", confidence: "researched", source_urls: ["https://www.housing.com/x"], distanceKm: null };
    const r = await mount({ seasonTags: [tag], month: 10 }); await chooseRegion(r, "AP");
    const kond = cards(r).find((c) => text(c).includes("Kondapalli Fort"))!;
    expect(text(kond)).toContain("In season");
    const other = cards(r).find((c) => text(c).includes("Some Other Fort"))!;
    expect(text(other)).not.toContain("In season"); expect(text(other)).not.toContain("Out of season");
    await act(async () => { buttons(r, "Details")[0].props.onClick(); });
    expect(text(r.root)).toContain("Researched · housing.com"); expect(text(r.root)).toContain("Cool and dry");
  });
  it("an unresearched season row never marks anything", async () => {
    all = [{ ...mk(1)[0], name: "Kondapalli Fort", lat: 16.619, lng: 80.534 }];
    const draft: ExploreSeasonTag = { id: "s1", place_name: "Kondapalli Fort", lat: 16.619, lng: 80.534, category: "fort", good_months: [10], reason: null, region: null, confidence: "draft", source_urls: null, distanceKm: null };
    const r = await mount({ seasonTags: [draft] }); await chooseRegion(r, "AP");
    expect(text(r.root)).not.toContain("In season");
  });
  it("'Add to my ideas' exists only with a trip, sends the planner category, and shows it was added", async () => {
    const none = await mount(); await chooseRegion(none);
    expect(buttons(none, "Add to my ideas").filter((b) => b.props.className?.includes("min-h-11"))).toHaveLength(0);
    all = [{ ...mk(1)[0], category: "heritage" as const }];
    const r = await mount({ tripId: "t1", anchors: [] }); await chooseRegion(r);
    await press(r, "Add to my ideas");
    const call = requests.find((x) => x.url === "/api/places/bulk")!;
    expect(call.body).toMatchObject({ trip_id: "t1", places: [{ name: "Fort 01", lat: 17, lng: 78, category: "temple", source_type: "search" }] });
    expect(text(r.root)).toContain("Added to Ideas");
  });
});

describe("saving places (no trip needed)", () => {
  it("Save marks the place saved at once, stores it for me, and Saved lists it with a way to remove it", async () => {
    const r = await mount(); await chooseRegion(r, "TG");
    await press(r, "Save Fort 01");
    const post = requests.find((x) => x.url === "/api/saved-places" && x.method === "POST")!;
    expect(post.body).toEqual({ key: "way/1", name: "Fort 01", lat: 17, lng: 78, category: "fort", region: "Telangana" });
    expect(buttons(r, "Saved Fort 01")[0].props["aria-pressed"]).toBe(true); // the card's own button now reads "Saved"
    expect(text(r.root)).toContain("Saved (1)");
    await press(r, "Saved (1)");
    expect(text(r.root)).toContain("Fort 01");
    await press(r, "Remove");
    expect(requests.some((x) => x.method === "DELETE" && (x.body as { key: string }).key === "way/1")).toBe(true);
    expect(text(r.root)).toContain("Nothing saved yet.");
  });
  it("places saved earlier are already marked when you browse", async () => {
    savedRows = [{ place_key: "way/1", name: "Fort 01", lat: 17, lng: 78, category: "fort", region: null }];
    const r = await mount(); await chooseRegion(r);
    const first = cards(r)[0];
    expect(first.findAll((n) => n.type === "button" && n.props["aria-pressed"] === true)).toHaveLength(1);
  });
  it("if saving fails the screen goes back and says why (the limit message is shown as the server wrote it)", async () => {
    saveStatus = 409;
    const r = await mount(); await chooseRegion(r);
    await press(r, "Save Fort 01");
    expect(text(r.root)).toContain("You can save up to 500 places.");
    expect(text(r.root)).not.toContain("Saved (1)");
  });
  it("a failure to load saved places shows on the Saved tab only, not as a banner over Discover", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: string | URL | Request, i?: RequestInit) => (String(u) === "/api/saved-places" && !i?.method ? new Response("{}", { status: 500 }) : (base as typeof fetch)(u, i))) as unknown as typeof fetch;
    const r = await mount(); await chooseRegion(r);
    expect(text(r.root)).not.toContain("Couldn't load your saved places");
    await press(r, "Saved");
    expect(text(r.root)).toContain("Couldn't load your saved places");
  });
});

describe("a late answer to an old question is ignored", () => {
  it("switching region quickly shows the LAST choice's places, not whichever answer came back last", async () => {
    const releases: Record<string, () => void> = {};
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: string | URL | Request, i?: RequestInit) => {
      if (String(u) !== "/api/explore") return (base as typeof fetch)(u, i);
      const code = (JSON.parse(String(i?.body)).scope as { code: string }).code;
      await new Promise<void>((res) => { releases[code] = res; });
      const items = mk(2, () => ({ name: code === "KL" ? "Kerala Fort" : "Goa Fort" }));
      return new Response(JSON.stringify({ items: items.map((x, n) => ({ ...x, id: `way/${code}${n}` })), total: 2, nextCursor: null, source: "cache", stale: false, fetchedAt: "2026-10-10T00:00:00.000Z" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await mount();
    await act(async () => { choose(r.root, "explore-region", "KL"); });
    await act(async () => { choose(r.root, "explore-region", "GA"); });
    await act(async () => { releases.GA?.(); await Promise.resolve(); }); await flush();
    await act(async () => { releases.KL?.(); await Promise.resolve(); }); await flush(); // the old answer arrives late
    expect(text(r.root)).toContain("Goa Fort"); expect(text(r.root)).not.toContain("Kerala Fort");
  });
});
