import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StopCard } from "@/components/StopCard";
import { ExploreView, type ExploreSeasonTag } from "@/components/ExploreView";
import { forgetKnownPhotos } from "@/lib/client/use-place-photos";
import { forgetFailedImages } from "@/components/ui/SafeImg";
import type { Place } from "@/lib/types";
import type { PlacePhoto } from "@/lib/place-photos";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const photo: PlacePhoto = {
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Charminar.jpg/330px-Charminar.jpg", srcSet: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Charminar.jpg/120px-Charminar.jpg 120w",
  width: 500, height: 300, title: "Charminar", source: "wikipedia", pageUrl: "https://en.wikipedia.org/wiki/Charminar",
  creditUrl: "https://commons.wikimedia.org/wiki/File:Charminar.jpg", author: "Jane Doe", licence: "CC BY-SA 4.0", licenceUrl: null,
};
const place = (o: Partial<Place> = {}): Place => ({ id: "p1", trip_id: "t1", name: "Charminar", lat: 17.36, lng: 78.47, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1, arrival_time: "11:50:00", notes: null, added_by: null, created_at: "", category: "temple", address: null, drive_minutes: 30, drive_km: 32, status: "planned", status_at: null, priority: null, visit_minutes: null, ...o } as Place);
const base = { status: "unknown" as const, category: "temple" as const, score: null, moveDays: [1, 2, 3], onMove: vi.fn(), onRemove: vi.fn(), onVote: vi.fn(), onRelocate: vi.fn(), onStatus: vi.fn() };
const card = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement("ol", null, createElement(StopCard, { place: place(), ...base, ...extra } as never)));

describe("Plan stop card", () => {
  it("shows the real photo with author + licence credit when there is one", () => {
    const h = card({ photo });
    expect(h).toContain('alt="Photo of Charminar"');
    expect(h).toContain("Photo: Jane Doe, CC BY-SA 4.0");
    expect(h).toContain('href="https://commons.wikimedia.org/wiki/File:Charminar.jpg"');
    expect(h).toContain("120w");
  });
  it("looks exactly as before when there is no photo: no image, no credit, no empty gap", () => {
    const h = card();
    expect(h).not.toContain("<img");
    expect(h).not.toContain("Photo:");
    expect(card({ photo: null })).toBe(h);
  });
});

describe("Explore 'Best in month' cards", () => {
  const pick = (id: string, name: string, lat: number) => ({
    item: { id, name, category: "temple", lat, lng: 78.47, notable: true, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null },
    fit: { verdict: "great", score: 100, why: "Usually 27 °C by day, rain on about 10% of days" }, researched: null, km: 12,
  });
  const realFetch = globalThis.fetch;
  const anchors = [{ id: "d", label: "Hyderabad", lat: 17.38, lng: 78.48 }];
  const serve = (photoStatus: number) => vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    if (url === "/api/explore/season") return new Response(JSON.stringify({ picks: [pick("wd:Q1", "Charminar", 17.36), pick("wd:Q2", "Sri Rama Temple", 17.5)], empty: null, candidates: 2, basis: "weather", month: 10 }), { status: 200 });
    if (url === "/api/place-photos") {
      if (photoStatus !== 200) return new Response("{}", { status: photoStatus });
      const { places } = JSON.parse(String(init?.body)) as { places: { key: string; name: string }[] };
      return new Response(JSON.stringify({ photos: Object.fromEntries(places.filter((p) => p.name === "Charminar").map((p) => [p.key, photo])) }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [], nextCursor: null, total: 0, places: [], destinations: [], source: "catalog", stale: false, fetchedAt: "2026-11-01T00:00:00Z" }), { status: 200 });
  }) as unknown as typeof fetch;
  beforeEach(() => { forgetKnownPhotos(); forgetFailedImages(); });
  afterEach(() => { globalThis.fetch = realFetch; });
  const mount = async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<ExploreView tripId={null} anchors={anchors} seasonTags={[]} month={10} />, { createNodeMock: () => ({ complete: false, naturalWidth: 0 }) }); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    return r;
  };

  it("puts the real photo on the card that has one and leaves the other card as it was", async () => {
    globalThis.fetch = serve(200);
    const r = await mount();
    const imgs = r.root.findAllByType("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].props.alt).toBe("Photo of Charminar");
    const text = JSON.stringify(r.toJSON());
    expect(text).toContain("Photo: Jane Doe, CC BY-SA 4.0");
    expect(text).toContain("Sri Rama Temple"); // the other card is still there, without a photo
  });
  it("shows the cards normally, with icons, when the lookup is rate-limited", async () => {
    globalThis.fetch = serve(429);
    const r = await mount();
    expect(r.root.findAllByType("img")).toHaveLength(0);
    expect(JSON.stringify(r.toJSON())).toContain("Charminar");
  });
});
