import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { distanceKm } from "@/lib/geo";
import { getSeasonStatus } from "@/lib/season";
import { matchSeasonTag, type SeasonTagLite } from "@/lib/season-match";
import { buildSql } from "../scripts/season-sql.mjs";

const root = join(__dirname, "..");
const { places } = JSON.parse(readFileSync(join(root, "data", "season-tags.json"), "utf8")) as {
  places: Parameters<typeof buildSql>[0];
};

describe("curated season data — quality gate", () => {
  it("has data", () => {
    expect(places.length).toBeGreaterThanOrEqual(15);
  });

  it("names are unique (case-insensitive) — the database enforces this too", () => {
    const names = places.map((p) => p.place_name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(places.map((p) => [p.place_name, p] as const))("%s: structurally valid", (_name, p) => {
    expect(Object.keys(CATEGORIES)).toContain(p.category);
    expect(p.good_months.length).toBeGreaterThan(0);
    expect(p.good_months.length).toBeLessThanOrEqual(12);
    expect(new Set(p.good_months).size).toBe(p.good_months.length);
    for (const m of p.good_months) expect(Number.isInteger(m) && m >= 1 && m <= 12).toBe(true);
    // India bounding box — catches swapped lat/lng and typos.
    expect(p.lat).toBeGreaterThan(6);
    expect(p.lat).toBeLessThan(37.5);
    expect(p.lng).toBeGreaterThan(68);
    expect(p.lng).toBeLessThan(98);
    expect(p.reason.length).toBeGreaterThan(20);
    expect(p.reason.length).toBeLessThanOrEqual(300);
    expect(["Andhra Pradesh", "Telangana"]).toContain(p.region);
    expect(p.last_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(places.map((p) => [p.place_name, p] as const))("%s: 'researched' means real, independent sources", (_name, p) => {
    if (p.confidence !== "researched") return;
    expect(p.source_urls.length).toBeGreaterThanOrEqual(1);
    for (const u of p.source_urls) expect(() => new URL(u)).not.toThrow();
    for (const u of p.source_urls) expect(new URL(u).protocol).toBe("https:");
    // Evidence must come from at least two different sites unless it's a single authoritative guide.
    const hosts = new Set(p.source_urls.map((u) => new URL(u).hostname.replace(/^www\./, "")));
    if (p.source_urls.length > 1) expect(hosts.size).toBeGreaterThanOrEqual(2);
  });

  it("places are in the right STATE neighbourhood (catches the 'Vijayawada in Maharashtra' class of mistake)", () => {
    const VIJAYAWADA = { lat: 16.5062, lng: 80.648 };
    const HYDERABAD = { lat: 17.385, lng: 78.4867 };
    for (const p of places) {
      // Everything in this dataset lies within ~900 km of Vijayawada or Hyderabad, i.e. AP/Telangana — never western India.
      const near = Math.min(distanceKm(VIJAYAWADA, p), distanceKm(HYDERABAD, p));
      expect(near, `${p.place_name} looks misplaced`).toBeLessThan(900);
      expect(p.lng, `${p.place_name} is west of Telangana`).toBeGreaterThan(77);
    }
  });

  it("the generated SQL migration matches the JSON exactly (run `npm run build:season` if this fails)", () => {
    const onDisk = readFileSync(join(root, "supabase", "migrations", "20261008000100_season_data_andhra_telangana.sql"), "utf8");
    expect(onDisk).toBe(buildSql(places));
  });

  it("SQL generation escapes apostrophes safely", () => {
    const sql = buildSql([{ ...places[0], place_name: "Tiger's Leap", reason: "It's dry; DROP TABLE x;--" }]);
    expect(sql).toContain("'Tiger''s Leap'");
    expect(sql).toContain("'It''s dry; DROP TABLE x;--'");
  });
});

describe("matching real places to the curated data", () => {
  const tags: SeasonTagLite[] = places.map((p, i) => ({ id: `t${i}`, place_name: p.place_name, lat: p.lat, lng: p.lng, category: p.category, good_months: p.good_months, reason: p.reason }));
  const find = (name: string, lat: number, lng: number) => matchSeasonTag({ name, lat, lng }, tags)?.place_name ?? null;

  it("matches what a geocoder would return for Vijayawada & Hyderabad sights", () => {
    expect(find("Kondapalli Fort", 16.6186, 80.5336)).toBe("Kondapalli Fort");
    expect(find("Undavalli Caves", 16.4967, 80.5806)).toBe("Undavalli Caves");
    expect(find("Golconda", 17.3833, 78.4011)).toBe("Golconda Fort");
    expect(find("Kuntala Falls", 19.285, 78.503)).toBe("Kuntala Waterfall");
    expect(find("Araku Valley", 18.33, 82.88)).toBe("Araku Valley");
  });

  it("does not match a same-named place in the wrong part of India", () => {
    expect(find("Golconda Fort", 12.97, 77.59)).toBeNull(); // Bengaluru
    expect(find("Bogatha Waterfall", 18.76, 73.41)).toBeNull(); // Maharashtra
  });

  it("gives the right verdicts for real dates", () => {
    const kuntala = places.find((p) => p.place_name === "Kuntala Waterfall")!;
    expect(getSeasonStatus(kuntala.good_months, 8)).toBe("good"); // August monsoon
    expect(getSeasonStatus(kuntala.good_months, 5)).toBe("wrong_season"); // dry May
    const papi = places.find((p) => p.place_name === "Papikondalu Boat Cruise")!;
    expect(getSeasonStatus(papi.good_months, 8)).toBe("wrong_season"); // boats suspended in floods
    expect(getSeasonStatus(papi.good_months, 12)).toBe("good");
  });
});
