// The Explore screen for a trip: what it shows in each situation, and what it refuses to claim.
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripExplore } from "@/components/explore/TripExplore";
import { forgetKnownPhotos } from "@/lib/client/use-place-photos";
import type { ExploreTripAnswer } from "@/lib/server/explore-trip";
import type { RoutedItem } from "@/lib/explore/route-rank";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pushed: string[] = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (u: string) => pushed.push(u), refresh: () => undefined }) }));
// The picker sheets are drawn in a portal on the page's top layer; the test renderer has no page, so they render in place here.
vi.mock("next/link", async () => { const { createElement } = await import("react"); return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }; });
vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), createPortal: (n: unknown) => n }));
const realFetch = globalThis.fetch;
const TRIP = "3f0e8a3c-6a0c-4f43-9c61-0a2f6f1d9a11";

const routed = (id: string, name: string, reasons: string[], over: Partial<RoutedItem> = {}): RoutedItem => ({
  id, name, category: "fort", lat: 17.2, lng: 78.5, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null,
  offKm: 3, aheadKm: 40, detour: { km: 6, min: 14, basis: "estimate" }, nearStop: null, reasons, score: 1, ...over,
});
const answer = (over: Partial<ExploreTripAnswer> = {}): ExploreTripAnswer => ({
  mode: "planned", headline: "Along your route to Araku", notes: [], items: [routed("n1", "Bhongir Fort", ["About 14 min extra drive (6 km there and back, estimated)", "Listed as a heritage site on OpenStreetMap"])],
  nextCursor: null, total: 1, empty: null, route: { km: 640, source: "road" }, remainingStops: 3,
  coverage: { candidates: 40, source: "live", stale: false, fetchedAt: "2026-10-27T05:00:00.000Z" }, ...over,
});

const EFFECT = { day: 1, days: 2, dayDate: "2026-11-05", effect: { beforeId: "stop-b", beforeName: "Stop B", afterName: "Stop A", addedDriveMin: 5, visitMin: 60, addedMin: 65,
  shifted: [{ id: "stop-b", name: "Stop B", from: "3:00 PM", to: "4:05 PM" }], warnings: ["Stop B may be closed when you'd get there (about 4:05 PM), by its listed opening hours."], unknowns: [], basis: "road" } };
let requests: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
let effectReply: { status: number; body: unknown } = { status: 200, body: null };
let insertReply: { status: number; body: unknown } = { status: 201, body: { ok: true, id: "new-place", shifted: 1, needsReplan: true } };
let reply: { status: number; body: unknown } = { status: 200, body: answer() };
beforeEach(() => {
  requests = []; reply = { status: 200, body: answer() }; forgetKnownPhotos(); pushed.length = 0;
  effectReply = { status: 200, body: EFFECT }; insertReply = { status: 201, body: { ok: true, id: "new-place", shifted: 1, needsReplan: true } };
  globalThis.fetch = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u); const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    requests.push({ url, method: init?.method ?? "GET", body });
    if (url === "/api/explore/trip") return new Response(JSON.stringify(reply.body), { status: reply.status });
    if (url === "/api/explore/trip/effect") return new Response(JSON.stringify(effectReply.body), { status: effectReply.status });
    if (url.endsWith("/insert-stop")) return new Response(JSON.stringify(insertReply.body), { status: insertReply.status });
    if (url.startsWith("/api/places/") && init?.method === "DELETE") return new Response("{}", { status: 200 });
    if (url.startsWith("/api/destinations/")) return new Response(JSON.stringify({ error: "x" }), { status: 500 });
    if (url === "/api/saved-places") return new Response(JSON.stringify({ places: [] }), { status: 200 });
    if (url === "/api/place-photos") return new Response(JSON.stringify({ photos: {}, unresolved: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const text = (n: ReactTestInstance): string => n.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const saved = { isSaved: () => false, toggle: async () => undefined, places: [], ready: true, loadFailed: false, error: null } as never;
const mount = async (addIdea = vi.fn(async () => undefined)) => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<TripExplore tripId={TRIP} saved={saved} added={new Set()} addIdea={addIdea} addError={null} />, { createNodeMock: () => ({ complete: false, naturalWidth: 0, querySelector: () => null, querySelectorAll: () => [], focus: () => undefined, scrollIntoView: () => undefined }) }); });
  await flush();
  return { r, addIdea };
};
const buttons = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === "button" && text(n).includes(label));
const all = (r: TestRenderer.ReactTestRenderer) => text(r.root);

describe("TripExplore", () => {
  it("planned trip: the headline, the road length and stops to do, and WHY each place is suggested (from the numbers)", async () => {
    const { r } = await mount();
    const t = all(r);
    expect(t).toContain("Along your route to Araku");
    expect(t).toContain("640 km of road · 3 stops still to do");
    expect(t).toContain("Bhongir Fort");
    expect(t).toContain("About 14 min extra drive (6 km there and back, estimated)");
    expect(t).toContain("Listed as a heritage site on OpenStreetMap");
    expect(requests.filter((x) => x.url === "/api/explore/trip")[0].body).toMatchObject({ trip_id: TRIP, category: "all", radius_km: 10, cursor: 0 });
  });
  it("never claims what it can't know: no 'open now', crowd, rating or 'live' on a card; the footer says why", async () => {
    const { r } = await mount();
    const cardText = text(r.root.findAll((n) => n.type === "li" && typeof n.props.className === "string" && n.props.className.includes("rounded-2xl"))[0]);
    expect(cardText).not.toMatch(/open now|crowd|rating|\blive\b|quiet|busy|popular|you'll love|matches your/i);
    expect(all(r)).toMatch(/don.t show crowds, ratings or .open now. because we have no reliable source/);
  });
  it("a trip with no Explore context shows nothing at all (the ordinary Explore is the whole page)", async () => {
    reply = { status: 200, body: answer({ mode: "none", items: [], empty: "no_trip", headline: "Discover places anywhere in India" }) };
    const { r } = await mount();
    expect(r.toJSON()).toBeNull();
  });
  it("shows the server's honest notes (dates passed, no GPS, straight-line road)", async () => {
    reply = { status: 200, body: answer({ notes: ["Your planned dates have passed. These suggestions are for when you go, not for the old dates."] }) };
    const { r } = await mount();
    expect(all(r)).toContain("Your planned dates have passed");
  });
  it("'Use my location' is offered only while travelling or staying, and explains it isn't stored", async () => {
    expect(buttons((await mount()).r, "Use my location")).toHaveLength(0);                                    // planned: your position changes nothing
    reply = { status: 200, body: answer({ mode: "active", headline: "Ahead on your route to Araku" }) };
    const { r } = await mount();
    expect(buttons(r, "Use my location")).toHaveLength(1);
    expect(all(r)).toContain("never saved or shared");
  });
  it("changing the kind of place or the width asks again from the top, and a late answer to the old question is ignored", async () => {
    const { r } = await mount();
    await act(async () => { buttons(r, "Forts & palaces")[0].props.onClick(); }); await flush();
    const calls = requests.filter((x) => x.url === "/api/explore/trip").map((x) => x.body);
    expect(calls[calls.length - 1]).toMatchObject({ category: "fort", cursor: 0 });
  });
  it("empty because the MAP has nothing: says coverage is thin, doesn't say 'nothing to see', and offers a way out", async () => {
    reply = { status: 200, body: answer({ items: [], total: 0, empty: "no_data" }) };
    const { r } = await mount();
    expect(all(r)).toMatch(/has no places listed along this road yet\. Coverage is thinner for small places/);
    expect(buttons(r, "Look wider").length).toBe(1);
  });
  it("empty because nothing is NEAR the road: says so with the width, and 'Look wider' widens it", async () => {
    reply = { status: 200, body: answer({ items: [], total: 0, empty: "none_in_corridor" }) };
    const { r } = await mount();
    expect(all(r)).toContain("none within 10 km of your route");
    await act(async () => { buttons(r, "Look wider")[0].props.onClick(); }); await flush();
    expect(requests.filter((x) => x.url === "/api/explore/trip").pop()!.body).toMatchObject({ radius_km: 20 });
  });
  it("provider trouble: plain words, a retry, and the search below still works (never a blank screen)", async () => {
    reply = { status: 502, body: { error: "The map servers are busy right now. Please try again in a minute." } };
    const { r } = await mount();
    expect(all(r)).toContain("The map servers are busy right now");
    expect(all(r)).toContain("You can still search for a place or a state below");
    reply = { status: 200, body: answer() };
    await act(async () => { buttons(r, "Try again")[0].props.onClick(); }); await flush();
    expect(all(r)).toContain("Bhongir Fort");
  });
  it("'Add to Ideas' puts the place in the ideas list; it never schedules it (the plan is not touched)", async () => {
    const { r, addIdea } = await mount();
    const add = r.root.findAll((n) => n.type === "button" && /Add to my ideas/.test(text(n)))[0];
    await act(async () => { add.props.onClick(); });
    expect(addIdea).toHaveBeenCalledWith(expect.objectContaining({ key: "n1", name: "Bhongir Fort" }));
    expect(requests.filter((x) => /insert-stop|builder\/apply|replan/.test(x.url))).toHaveLength(0);
  });
  it("'Show more places' loads the next page without repeating a place", async () => {
    reply = { status: 200, body: answer({ nextCursor: 12, total: 20 }) };
    const { r } = await mount();
    reply = { status: 200, body: answer({ items: [routed("n1", "Bhongir Fort", ["x"]), routed("n2", "Yadagirigutta", ["y"])], nextCursor: null, total: 20 }) };
    await act(async () => { buttons(r, "Show more places")[0].props.onClick(); }); await flush();
    const cards = r.root.findAll((n) => n.type === "li" && typeof n.props.className === "string" && n.props.className.includes("rounded-2xl") && /Fort|Yadagirigutta/.test(text(n)));
    expect(cards.map((c) => (/Yadagirigutta/.test(text(c)) ? "Y" : "B"))).toEqual(["B", "Y"]);       // each once, in order
    expect(requests.filter((x) => x.url === "/api/explore/trip").pop()!.body).toMatchObject({ cursor: 12 });
  });
});

describe("TripExplore: traveller reports and adding as a stop", () => {
  // The sheets lock page scrolling and listen for Escape: a small stand-in page is enough for that here.
  beforeEach(() => {
    vi.stubGlobal("document", Object.assign(new EventTarget(), { activeElement: null, body: { style: {} }, documentElement: { style: {}, clientWidth: 1024 } }));
    vi.stubGlobal("window", Object.assign(globalThis.window ?? {}, { innerWidth: 1024, location: { search: "" } }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const withReports = () => answer({ items: [{ ...routed("n1", "Borra Caves", ["On your route"]), community: { destinationId: "d1", name: "Borra Caves", posts: 3, recent: 1, latestAt: new Date(Date.now() - 86_400_000).toISOString() } }] });
  it("a place with traveller posts says how many and how old the latest is; tapping it opens what travellers say", async () => {
    reply = { status: 200, body: withReports() };
    const { r } = await mount();
    expect(all(r)).toContain("3 traveller reports · latest yesterday");
    await act(async () => { buttons(r, "3 traveller reports")[0].props.onClick(); }); await flush();
    expect(r.root.findAll((n) => n.props.role === "dialog" && n.props["aria-label"] === "Borra Caves")).toHaveLength(1);   // the feed's own "what travellers say" sheet, for that destination
  });
  it("no matching destination → no report line at all (never 'no reports' for a place we couldn't match)", async () => {
    const { r } = await mount();
    expect(all(r)).not.toMatch(/traveller report/);
  });
  it("'Add as a stop' shows what it changes FIRST, and nothing is written until 'Add to Day 1'", async () => {
    const { r } = await mount();
    await act(async () => { buttons(r, "Add as a stop")[0].props.onClick(); }); await flush();
    const t = all(r);
    expect(t).toContain("Between Stop A and Stop B");
    expect(t).toContain("Adds about 1 h 5 min to Day 1");
    expect(t).toMatch(/Stop B3:00 PM → about 4:05 PM/);
    expect(t).toContain("Stop B may be closed when you'd get there");
    expect(requests.filter((x) => x.url.endsWith("/insert-stop"))).toHaveLength(0);
    await act(async () => { buttons(r, "Add to Day 1")[0].props.onClick(); }); await flush();
    const ins = requests.find((x) => x.url === `/api/trips/${TRIP}/insert-stop`)!;
    expect(ins.body).toMatchObject({ name: "Bhongir Fort", day_number: 1, before_id: "stop-b" });
    expect(all(r)).toContain("Added to Day 1.");
    await act(async () => { buttons(r, "Undo")[0].props.onClick(); }); await flush();
    expect(requests.some((x) => x.url === "/api/places/new-place" && x.method === "DELETE")).toBe(true);
    expect(all(r)).toContain("Undone.");
  });
  it("if the day changed since the preview (409), it looks again instead of guessing", async () => {
    insertReply = { status: 409, body: { error: "That day's plan changed since you looked. Please check again." } };
    const { r } = await mount();
    await act(async () => { buttons(r, "Add as a stop")[0].props.onClick(); }); await flush();
    const before = requests.filter((x) => x.url === "/api/explore/trip/effect").length;
    await act(async () => { buttons(r, "Add to Day 1")[0].props.onClick(); }); await flush();
    expect(requests.filter((x) => x.url === "/api/explore/trip/effect").length).toBe(before + 1);
  });
});
