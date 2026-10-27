import { allSelects } from "./helpers/select";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExploreView } from "@/components/ExploreView";
import { forgetKnownPhotos } from "@/lib/client/use-place-photos";
import { forgetFailedImages } from "@/components/ui/SafeImg";
// Explore with a trip shows the trip section, which can send the person to Discover: a router stand-in for these tests.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
const requests: { url: string; body: unknown }[] = [];
let nearby: unknown[] = [];
const suggestions: unknown[] = [{ name: "Hampi", address: "Vijayanagara, Karnataka", lat: 15.335, lng: 76.46, source: "trailmate", posts: 4 }];

const sights = [
  { id: "n/1", name: "Virupaksha Temple", kind: "sights", lat: 15.335, lng: 76.46, km: 0.4, hours: null, notable: true,
    photo: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Virupaksha.jpg/330px-Virupaksha.jpg", source: "commons", creditUrl: "https://commons.wikimedia.org/wiki/File:Virupaksha.jpg", author: "Jane Doe", licence: "CC BY-SA 4.0" } },
  { id: "n/2", name: "Roadside Shrine", kind: "sights", lat: 15.34, lng: 76.47, km: 1.2, hours: null, photo: null },
];

beforeEach(() => {
  forgetKnownPhotos(); forgetFailedImages(); requests.length = 0; nearby = sights;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: u, body });
    if (u.startsWith("/api/destinations/suggest")) return new Response(JSON.stringify({ destinations: suggestions }), { status: 200 });
    if (u === "/api/nearby") return new Response(JSON.stringify({ places: nearby }), { status: 200 });
    if (u === "/api/place-photos") return new Response(JSON.stringify({ photos: {}, unresolved: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const text = (n: ReactTestInstance): string => n.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
const button = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === "button" && text(n).includes(label))[0];
const mount = async (props: Partial<React.ComponentProps<typeof ExploreView>> = {}) => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<ExploreView tripId={null} anchors={[]} seasonTags={[]} month={10} {...props} />, { createNodeMock: () => ({ complete: false, naturalWidth: 0 }) }); });
  await act(async () => { await Promise.resolve(); });
  return r;
};

describe("Explore: anywhere in India, not only the places in your trip", () => {
  it("offers the search even with no trip at all (it used to say 'Create a trip…' and stop)", () => {
    const html = renderToStaticMarkup(<ExploreView tripId={null} anchors={[]} seasonTags={[]} month={10} />);
    expect(html).toContain("Explore anywhere in India");
    expect(html).toContain("Pick a place above");
    expect(html).not.toContain("Create a trip with a start or destination to explore around it.</p>");
  });

  it("shows places travellers have shared as one-tap starting points, then explores the picked place", async () => {
    const r = await mount();
    expect(text(r.root)).toContain("Popular with travellers");
    await act(async () => { button(r, "Hampi").props.onClick(); });
    await act(async () => { await Promise.resolve(); });
    const call = requests.find((x) => x.url === "/api/nearby");
    expect(call?.body).toMatchObject({ kind: "sights", lat: 15.335, lng: 76.46, radius_km: 25 });
    expect(text(r.root)).toContain("Around Hampi");
    expect(text(r.root)).toContain("Virupaksha Temple");
  });

  it("marks well-known places and credits each photo with its author and licence", async () => {
    const r = await mount();
    await act(async () => { button(r, "Hampi").props.onClick(); });
    await act(async () => { await Promise.resolve(); });
    const t = text(r.root);
    expect(t).toContain("Well known");
    expect(t).toContain("Photo: Jane Doe, CC BY-SA 4.0");
    const imgs = r.root.findAllByType("img");
    expect(imgs.map((i) => i.props.alt)).toEqual(["Photo of Virupaksha Temple"]); // the shrine without a photo has an icon, not a stand-in
    const credit = r.root.findAll((n) => n.type === "a" && text(n).includes("Photo: Jane Doe"))[0];
    expect(credit.props.href).toBe("https://commons.wikimedia.org/wiki/File:Virupaksha.jpg");
  });

  it("is honest that season guidance exists only for researched places", async () => {
    const r = await mount();
    await act(async () => { button(r, "Hampi").props.onClick(); });
    await act(async () => { await Promise.resolve(); });
    expect(text(r.root)).toContain("haven't researched the best months");
  });

  it("with a trip, its start/destination are still offered alongside the searched place", async () => {
    const r = await mount({ tripId: "t1", anchors: [{ id: "dest", label: "Mothkur", lat: 17.5, lng: 78.9 }] });
    await act(async () => { button(r, "Hampi").props.onClick(); });
    await act(async () => { await Promise.resolve(); });
    // Both the Discover section and the food/stays section offer the same places to look around.
    const placeSelects = allSelects(r.root).map((sel) => sel.options.map((o) => o.label)).filter((o) => o.includes("Mothkur"));
    expect(placeSelects).toHaveLength(2);
    for (const options of placeSelects) expect(options).toEqual(["Hampi", "Mothkur"]);
  });

  it("a failed search shows an error with a retry, and nothing else changes", async () => {
    const r = await mount();
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => String(url).startsWith("/api/destinations") ? new Response(JSON.stringify({ destinations: suggestions }), { status: 200 }) : new Response(JSON.stringify({ error: "Nearby search is busy right now." }), { status: 502 })) as unknown as typeof fetch;
    await act(async () => { button(r, "Hampi").props.onClick(); });
    await act(async () => { await Promise.resolve(); });
    expect(text(r.root)).toContain("Nearby search is busy right now.");
    expect(text(r.root)).toContain("Try again");
  });
});
