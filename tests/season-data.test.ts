import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { getSeasonStatus } from "@/lib/season";
import { matchSeasonTag, type SeasonTagLite } from "@/lib/season-match";
import { buildSql, nextVersion, seasonMigrations } from "../scripts/season-sql.mjs";

// Rough bounding box of each state the data may use (degrees). A place must sit inside ITS state's box: this catches swapped
// lat/lng, typos and the "Vijayawada in Maharashtra" class of mistake. To add a new state, add its box here first.
const STATE_BOX: Record<string, { lat: [number, number]; lng: [number, number] }> = {
  "Andhra Pradesh": { lat: [12.6, 19.95], lng: [76.7, 84.8] },
  Telangana: { lat: [15.8, 19.95], lng: [77.2, 81.35] },
  Karnataka: { lat: [11.5, 18.5], lng: [74.0, 78.6] },
};

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
    expect(Object.keys(STATE_BOX), `${p.place_name}: unknown state "${p.region}"`).toContain(p.region);
    expect(["researched", "draft"]).toContain(p.confidence);
    expect(p.last_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(places.map((p) => [p.place_name, p] as const))("%s: every source is a real https link", (_name, p) => {
    expect(p.source_urls.length).toBeGreaterThanOrEqual(1);
    for (const u of p.source_urls) expect(() => new URL(u)).not.toThrow();
    for (const u of p.source_urls) expect(new URL(u).protocol).toBe("https:");
  });

  it.each(places.filter((p) => p.confidence === "researched").map((p) => [p.place_name, p] as const))("%s: 'researched' means 2+ sources from DIFFERENT websites", (_name, p) => {
    const hosts = new Set(p.source_urls.map((u) => new URL(u).hostname.replace(/^www\./, "")));
    expect(hosts.size).toBeGreaterThanOrEqual(2);
  });

  it("every place lies inside its own state (catches the 'Vijayawada in Maharashtra' class of mistake)", () => {
    for (const p of places) {
      const box = STATE_BOX[p.region];
      expect(p.lat >= box.lat[0] && p.lat <= box.lat[1] && p.lng >= box.lng[0] && p.lng <= box.lng[1], `${p.place_name} is not inside ${p.region}`).toBe(true);
    }
  });

  it("the NEWEST season migration matches the JSON exactly (run `npm run build:season` if this fails)", () => {
    const dir = join(root, "supabase", "migrations");
    const latest = seasonMigrations(readdirSync(dir)).at(-1)!;
    expect(readFileSync(join(dir, latest), "utf8")).toBe(buildSql(places));
  });

  it("the applied 2026-10-08 season migration is never rewritten", () => {
    const old = readFileSync(join(root, "supabase", "migrations", "20261008000100_season_data_andhra_telangana.sql"), "utf8");
    expect(old).toContain("TRAILMATE — curated season data: Andhra Pradesh & Telangana (19 places)");
    expect(old).toMatch(/'RK Beach Visakhapatnam'[^\n]*'researched'/); // as it was applied
  });

  it("a new season migration always sorts after every existing migration", () => {
    const files = ["20261008000100_season_data_andhra_telangana.sql", "20261023000000_invite_rotation_expiry.sql"];
    expect(nextVersion(files, new Date("2026-10-16T10:00:00Z"))).toBe("20261023000001"); // the clock is behind the newest file
    expect(nextVersion(files, new Date("2026-11-02T08:30:15Z"))).toBe("20261102083015");
    expect(seasonMigrations([...files, "20261023000001_season_data.sql", "x.sql"])).toEqual(["20261008000100_season_data_andhra_telangana.sql", "20261023000001_season_data.sql"]);
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

// Draft batches waiting for review (data/season-drafts/*.json, NOT read by the app): already valid, so approving one is just a move.
describe("draft batches under review", () => {
  const dir = join(root, "data", "season-drafts");
  const files = (() => { try { return readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; } })();
  const drafts = files.flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { places: { record: (typeof places)[number]; review: { proposed_confidence: string; evidence: unknown[] } }[] }).places.map((p) => ({ file: f, ...p })));
  if (drafts.length === 0) it("nothing is waiting for review", () => expect(drafts).toEqual([]));
  else it.each(drafts.map((d) => [`${d.file}: ${d.record.place_name}`, d] as const))("%s is valid, unapproved, inside its state and backed by 2+ websites", (_n, d) => {
    const p = d.record;
    expect(p.confidence).toBe("draft"); // never 'researched' until a person approved it
    expect(Object.keys(CATEGORIES)).toContain(p.category);
    for (const m of p.good_months) expect(Number.isInteger(m) && m >= 1 && m <= 12).toBe(true);
    expect(new Set(p.good_months).size).toBe(p.good_months.length);
    expect(p.reason.length).toBeGreaterThan(20);
    expect(p.reason.length).toBeLessThanOrEqual(300);
    const box = STATE_BOX[p.region];
    expect(box, p.region).toBeDefined();
    expect(p.lat >= box.lat[0] && p.lat <= box.lat[1] && p.lng >= box.lng[0] && p.lng <= box.lng[1], `${p.place_name} outside ${p.region}`).toBe(true);
    const hosts = new Set(p.source_urls.map((u) => new URL(u).hostname.replace(/^www\./, "")));
    for (const u of p.source_urls) expect(new URL(u).protocol).toBe("https:");
    expect(hosts.size).toBeGreaterThanOrEqual(2);
    expect(d.review.evidence.length).toBeGreaterThanOrEqual(2);
    expect(places.map((x) => x.place_name.toLowerCase())).not.toContain(p.place_name.toLowerCase()); // not already in the data
  });
});
