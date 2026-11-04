import { describe, expect, it } from "vitest";
import { fitForMonth, pickForMonth, climateLine, type Climate, type ResearchedSeason } from "@/lib/explore/season-picks";
import { exploreSeason } from "@/lib/server/explore-season";
import { catalogAsk } from "@/lib/catalog/read";
import { exploreTripSchema, exploreSeasonSchema } from "@/lib/validation/schemas";
import type { ExploreItem } from "@/lib/explore/items";
import type { ExploreCategoryId } from "@/lib/explore/categories";

const item = (id: string, category: ExploreCategoryId, lat = 17, lng = 78): ExploreItem => ({ id, name: `Place ${id}`, category, lat, lng, notable: true, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null });
const winter: Climate = { avgHighC: 27, rainMmPerDay: 0.3, rainyDayShare: 0.05 };
const monsoon: Climate = { avgHighC: 28, rainMmPerDay: 9, rainyDayShare: 0.8 };
const summer: Climate = { avgHighC: 41, rainMmPerDay: 0.2, rainyDayShare: 0.03 };

describe("fitForMonth: the verdict comes from the real numbers and the kind of place", () => {
  it("a fort is great in a cool dry month, poor in scorching heat or the heavy rains", () => {
    expect(fitForMonth("fort", winter).verdict).toBe("great");
    expect(fitForMonth("fort", summer).verdict).toBe("poor");
    expect(fitForMonth("fort", monsoon).verdict).toBe("poor");
  });
  it("a waterfall is best when it rains, and poor when it is dry", () => {
    expect(fitForMonth("waterfall", { avgHighC: 28, rainMmPerDay: 6, rainyDayShare: 0.55 }).verdict).toBe("great");
    expect(fitForMonth("waterfall", winter).verdict).toBe("poor");
  });
  it("a beach is great when warm and dry, poor in the rains", () => {
    expect(fitForMonth("beach", winter).verdict).toBe("great");
    expect(fitForMonth("beach", monsoon).verdict).toBe("poor");
  });
  it("shows the numbers it used", () => {
    expect(climateLine(winter)).toBe("Usually 27 °C by day, rain on about 5% of days");
    expect(fitForMonth("fort", winter).why).toContain("27 °C");
  });
});

describe("pickForMonth", () => {
  const c = (items: ExploreItem[], climate: Climate | null) => items.map((i) => ({ item: i, climate }));
  it("a different climate gives a different list: the same places are picked in winter but not in the rains", () => {
    const items = [item("a", "fort"), item("b", "temple"), item("c", "waterfall")];
    expect(pickForMonth(c(items, winter), [], 12, null).map((p) => p.item.id)).toEqual(["a", "b"]);
    expect(pickForMonth(c(items, monsoon), [], 8, null).map((p) => p.item.id)).toEqual(["c"]);
  });
  it("skips places whose weather could not be read, and never more than 3 of one kind", () => {
    const forts = Array.from({ length: 6 }, (_, i) => item(`f${i}`, "fort"));
    expect(pickForMonth(c(forts, winter), [], 12, null)).toHaveLength(3);
    expect(pickForMonth(c(forts, null), [], 12, null)).toHaveLength(0);
  });
  it("researched places come first, carry their source, and a year-round entry is not 'best this month'", () => {
    const a = item("a", "fort"), b = item("b", "temple"), y = item("y", "lake");
    const tag = (id: string, months: number[]): ResearchedSeason => ({ id, place_name: id, lat: 17, lng: 78, category: "fort", good_months: months, reason: "Cool.", source_urls: ["https://www.example.org/x"] });
    const picks = pickForMonth([...c([a, b, y], winter)], [{ tag: tag("t1", [11, 12]), item: b }, { tag: tag("t2", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), item: y }], 12, { lat: 17, lng: 78 });
    expect(picks[0].item.id).toBe("b");
    expect(picks[0].researched).toEqual({ reason: "Cool.", source: "example.org" });
    expect(picks.find((p) => p.item.id === "y")?.researched).toBeNull();
    expect(picks[0].km).toBe(0);
  });
});

describe("exploreSeason (server)", () => {
  const db = { from: () => ({ select: async () => ({ data: [], error: null }) }) } as never;
  const places = [item("a", "fort", 17.1, 78.1), item("b", "waterfall", 17.2, 78.2), item("c", "temple", 19.0, 80.0)];
  const catalog = async () => ({ items: places, dataAt: 1 });
  it("weather per ~50 km square: the same places score differently where the weather differs", async () => {
    const climate = async (lat: number) => ({ ...(lat > 18 ? monsoon : winter), years: "2020–2025" });
    const r = await exploreSeason(db, { centre: { lat: 17, lng: 78, radiusKm: 100 }, month: 8, today: "2026-11-04" }, { catalog, climate });
    expect(r.empty).toBeNull();
    expect(r.picks.map((p) => p.item.id).sort()).toEqual(["a"]);   // the fort is fine in winter-like air; the temple's square is rainy; the waterfall's square is dry
  });
  it("says so, and shows nothing, when the weather can't be read", async () => {
    const r = await exploreSeason(db, { centre: { region: "TG" }, month: 11, today: "2026-11-04" }, { catalog, climate: async () => null });
    expect(r).toMatchObject({ picks: [], empty: "no_weather" });
  });
  it("says so when our place list isn't there", async () => {
    expect((await exploreSeason(db, { centre: { region: "TG" }, month: 11, today: "2026-11-04" }, { catalog: null })).empty).toBe("no_catalogue");
    expect((await exploreSeason(db, { centre: { region: "TG" }, month: 11, today: "2026-11-04" }, { catalog: async () => null })).empty).toBe("no_catalogue");
    expect((await exploreSeason(db, { centre: { region: "TG" }, month: 11, today: "2026-11-04" }, { catalog: async () => ({ items: [], dataAt: 1 }) })).empty).toBe("no_places");
  });
});

describe("50 km", () => {
  it("a road search may be 50 km wide and is asked of our own place list at that width", () => {
    expect(exploreTripSchema.safeParse({ trip_id: "11111111-1111-4111-8111-111111111111", radius_km: 50 }).success).toBe(true);
    expect(exploreTripSchema.safeParse({ trip_id: "11111111-1111-4111-8111-111111111111", radius_km: 60 }).success).toBe(false);
    const ask = catalogAsk({ kind: "route", line: [[78, 17], [79, 17.5]], radius_km: 50 }, "all");
    expect(ask?.args._buffer_m).toBe(50_000);
    expect(catalogAsk({ kind: "point", lat: 17, lng: 78, radius_km: 50 }, "all")?.args._radius_m).toBe(50_000);
  });
  it("'Best in month' takes a point with 50 or 100 km, or a state, and nothing else", () => {
    expect(exploreSeasonSchema.safeParse({ lat: 17, lng: 78, radius_km: 100, month: 11 }).success).toBe(true);
    expect(exploreSeasonSchema.safeParse({ region: "TG" }).success).toBe(true);
    expect(exploreSeasonSchema.safeParse({ lat: 17, lng: 78, radius_km: 70 }).success).toBe(false);
    expect(exploreSeasonSchema.safeParse({}).success).toBe(false);
  });
});
