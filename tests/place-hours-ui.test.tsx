// Slice C: the ONE hours view every screen uses, the words it uses, and the request the screens send. Answers here are made by the real
// resolver and ranking from made-up catalogue rows; nothing about a real place's hours is assumed.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceHoursView, exploreItemRef, placeParams } from "@/components/place/PlaceHours";
import { hoursBadge, nextStep, sourceLine } from "@/lib/place-intel/hours-labels";
import { readPlaceQuery, withIndexRole } from "@/lib/place-intel/hours-query";
import { placeRole } from "@/lib/place-intel/role";
import { resolveHours } from "@/lib/server/hours-resolver";
import { aroundWithHours } from "@/lib/server/hours-service";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import type { HoursAnswer } from "@/lib/place-intel/hours-answer";

const DATE = "2026-11-02";
let n = 0;
const row = (over: Record<string, unknown>) => ({ key: `osm:way/${++n}`, name: `Place ${n}`, category: "temple", lat: 15.05, lng: 78, notable: true, heritage: false, wikidata: `Q${n}`, wikipedia: null, sitelinks: 3,
  hours: null, website: null, osm_id: `way/${n}`, osm_date: "2026-10-28", wd_date: "2026-10-29", region_code: "AP", wd_type: null, osm_type: "amenity=place_of_worship", located_in: null, located_in_name: null,
  part_of: null, service_times: null, hours_url: null, check_date: null, ...over });
const db = (rows: unknown[]) => ({ rpc: async () => ({ data: rows, error: null }) }) as never;
const town = { name: "Ravipuram", lat: 15, lng: 78, kind: "city" as const, population: 400_000, state: "Andhra Pradesh" };
const html = (el: ReturnType<typeof h>) => renderToStaticMarkup(el);
const noop = () => {};

describe("a town: no single opening time, then the places in and around it", () => {
  it("says what the town is, lists its places with their own hours and reasons, and offers 'Add to my trip' that keeps the town", async () => {
    const around = (await aroundWithHours(db([
      row({ name: "Hilltop Shrine", wikipedia: "Hilltop Shrine", sitelinks: 30, hours: "Mo-Su 06:00-20:00", check_date: "2026-06-01" }),
      row({ name: "Old River Fort", category: "fort", osm_type: "historic=fort", sitelinks: 8, hours: "Tu-Su 09:00-17:00" }),
      row({ name: "Long Beach", category: "beach", osm_type: "natural=beach", sitelinks: 4 }),
    ]), town, DATE))!;
    const answer = resolveHours({ name: "Ravipuram", lat: 15, lng: 78, role: placeRole({ name: "x", kind: "city", population: 400_000 }) }, {}, DATE);
    const out = html(h(PlaceHoursView, { place: { name: "Ravipuram" }, answer, around, aroundLoading: false, aroundError: null, date: DATE, onDate: noop, onAdd: noop, added: (i) => i.name === "Long Beach" }));
    expect(out).toContain("Ravipuram is a city, so it has no single opening time.");
    expect(out).toContain("Places to visit in and around Ravipuram");
    expect(out).toContain("Hilltop Shrine");
    expect(out).toContain("Map data, checked 2026-06-01");                 // known, and says from where and when
    expect(out).toContain("Unconfirmed (map data)");                       // the fort's hours: shown, never as fact
    expect(out).toContain("Usually open ground");                          // the beach
    expect(out).toContain("Add to my trip");
    expect(out).toContain("On your trip");                                 // the one already added
    expect(out).toContain("Adding a place keeps Ravipuram on your trip.");
    expect(out).toMatch(/Why suggested: [^<]*Wikimedia pages describe it/);
    expect(out).not.toMatch(/hours (aren't|are not) available|Hours unavailable|No hours recorded<\/span>[^]*Ravipuram is a city/);
    expect(out).toContain("© OpenStreetMap contributors (ODbL) and Wikidata (CC0)");
  });
  it("when the catalogue can't be read, it says so instead of 'nothing here'", () => {
    const answer = resolveHours({ name: "Ravipuram", lat: 15, lng: 78, role: placeRole({ name: "x", kind: "town", population: 20_000 }) }, {}, DATE);
    const out = html(h(PlaceHoursView, { place: { name: "Ravipuram" }, answer, around: null, aroundLoading: false, aroundError: null, date: DATE, onDate: noop }));
    expect(out).toContain("We can&#x27;t suggest places right now");
  });
});

describe("a sight without usable hours: why, the official page, what to do", () => {
  const temple = { name: "Hill Shrine", lat: 15, lng: 78, role: placeRole({ name: "x", category: "temple", wdType: "Q842402" }) };
  it("nothing recorded: the reason, the page, and 'Add the hours you know' where the screen can take them", () => {
    const answer = resolveHours(temple, { osm: [{ ref: "osm/way/1", dataDate: "2026-10-28", openingHours: null, serviceTimes: null, hoursUrl: null, checkDate: null, website: "https://example.org" }] }, DATE);
    const out = html(h(PlaceHoursView, { place: { name: "Hill Shrine" }, answer, around: null, aroundLoading: false, aroundError: null, date: DATE, onDate: noop, onAddHours: noop }));
    expect(out).toContain("No opening hours are recorded for Hill Shrine on the map.");
    expect(out).toContain("Official website");
    expect(out).toContain("Add the hours you know");
    expect(out).toContain("not a promise of entry");
  });
  it("sources that disagree are both shown, with where each comes from", () => {
    const o = (ref: string, oh: string) => ({ ref, dataDate: "2026-10-28", openingHours: oh, serviceTimes: null, hoursUrl: null, checkDate: null, website: null });
    const answer = resolveHours(temple, { osm: [o("osm/way/1", "Mo-Su 06:00-20:00"), o("osm/node/2", "Mo-Su 09:00-17:00")] }, DATE);
    const out = html(h(PlaceHoursView, { place: { name: "Hill Shrine" }, answer, around: null, aroundLoading: false, aroundError: null, date: DATE, onDate: noop }));
    expect(out).toContain("Sources disagree");
    expect(out).toContain("What other sources say");
    expect(out).toContain("Mo-Su 09:00-17:00");
  });
});

describe("the words: confirmed and unconfirmed hours are never worded alike", () => {
  const src = (kind: "member" | "curated" | "osm", checked: boolean) => ({ kind, name: kind === "curated" ? "Trust page" : "x", ref: null, date: "2026-06-01", checked });
  it("badges", () => {
    expect(hoursBadge({ status: "known", source: src("member", true) }).label).toBe("Confirmed on your trip");
    expect(hoursBadge({ status: "known", source: src("osm", true) }).label).toBe("Map data, checked 2026-06-01");
    expect(hoursBadge({ status: "unverified", source: src("osm", false) })).toEqual({ label: "Unconfirmed (map data)", tone: "warn" });
    expect(hoursBadge({ status: "not_applicable", source: null }).label).toBe("No opening time of its own");
  });
  it("source lines say 'not confirmed' for unconfirmed data, and never for confirmed", () => {
    expect(sourceLine({ status: "unverified", source: src("osm", false) })).toMatch(/Not confirmed\.$/);
    expect(sourceLine({ status: "unverified", source: src("member", false) })).toBe("Source: map data saved on this trip, not confirmed by anyone.");
    expect(sourceLine({ status: "known", source: src("member", true) })).toBe("Source: confirmed by a member of this trip on 2026-06-01.");
    expect(sourceLine({ status: "known", source: src("osm", true) })).not.toMatch(/not confirmed/i);
  });
  it("a next step only where there is one", () => {
    expect(nextStep({ status: "none", officialLink: null }, true)).toBe("You can add the hours you know.");
    expect(nextStep({ status: "none", officialLink: { url: "https://e.org", label: "x" } }, false)).toBe("You can check the place's own page.");
    expect(nextStep({ status: "known", officialLink: null }, true)).toBeNull();
  });
});

describe("the request every screen sends", () => {
  it("place → query string → checked query, with its level", () => {
    const qs = placeParams({ name: "Hill Shrine", lat: 15.1, lng: 78.2, category: "temple", wd: "Q5", osm: "way/9" }, DATE);
    const r = readPlaceQuery(qs, 0);
    expect(r).toMatchObject({ ok: true, q: { name: "Hill Shrine", date: DATE, category: "temple", wd: "Q5", osm: "way/9", role: { role: "site" } } });
  });
  it("refuses what isn't a place in India, a bad date, or a made-up kind", () => {
    expect(readPlaceQuery(new URLSearchParams("name=X&lat=51.5&lng=-0.1"))).toMatchObject({ ok: false });
    expect(readPlaceQuery(new URLSearchParams("name=X&lat=15&lng=78&date=2026-13-40"))).toMatchObject({ ok: false });
    expect(readPlaceQuery(new URLSearchParams("name=X&lat=15&lng=78&category=casino"))).toMatchObject({ ok: false });
    expect(readPlaceQuery(new URLSearchParams("lat=15&lng=78"))).toMatchObject({ ok: false });
  });
  it("without a date, the date is today in India", () => {
    const r = readPlaceQuery(new URLSearchParams("name=X&lat=15&lng=78"), Date.parse("2026-11-01T20:00:00Z"));   // 01:30 on 2 Nov in India
    expect(r.ok && r.q.date).toBe("2026-11-02");
  });
  it("Explore / plan picks: the map id and the Wikidata id travel with the place", () => {
    expect(exploreItemRef({ id: "way/12", name: "A", lat: 1, lng: 2, category: "fort", wikidata: "Q7" })).toMatchObject({ osm: "way/12", wd: "Q7", category: "fort" });
    expect(exploreItemRef({ id: "osm:node/3", name: "A", lat: 1, lng: 2, category: "fort" })).toMatchObject({ osm: "node/3", wd: null });
    expect(exploreItemRef({ id: "wd:Q9", name: "A", lat: 1, lng: 2, category: "fort" })).toMatchObject({ osm: null, wd: "Q9" });
    expect(exploreItemRef({ id: "gn:44", name: "A", lat: 1, lng: 2 })).toMatchObject({ osm: null, kind: "sight" });
  });
  it("a trip stop that IS a town (by our India index) is answered as a town, never 'hours missing'", async () => {
    const ix = await loadGeoIndex();
    const hit = ix!.entries.find((e) => e.kind === "town" && e.pop > 50_000 && e.pop < 200_000)!;
    const r = readPlaceQuery(new URLSearchParams({ name: hit.name, lat: String(hit.lat + 0.001), lng: String(hit.lng) }));
    const q = withIndexRole((r as { ok: true; q: Parameters<typeof withIndexRole>[0] }).q, ix);
    expect(q.role.role).toBe("settlement");
    const a: HoursAnswer = resolveHours({ name: q.name, lat: q.lat, lng: q.lng, role: q.role }, {}, DATE);
    expect(a.status).toBe("not_applicable");
    // …and a stop named like nothing near it stays as it was (not turned into a town)
    const s = readPlaceQuery(new URLSearchParams({ name: "Zzyzx Shrine", lat: String(hit.lat), lng: String(hit.lng) }));
    expect(withIndexRole((s as { ok: true; q: Parameters<typeof withIndexRole>[0] }).q, ix).role.role).toBe("unknown");
  }, 60_000);
});
