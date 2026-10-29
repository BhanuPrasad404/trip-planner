// Shared by the place-catalogue scripts (docs/PLACE_CATALOG.md). Extract steps write plain JSON batches + a manifest to a folder; the
// load step sends a folder to the database. So one download can be checked, loaded into a test database first, and loaded again after a
// failure without fetching anything twice.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CatalogRow, CatalogSource } from "@/lib/catalog/types";
import type { RegionShape } from "@/lib/catalog/regions";

export function loadEnv(file = ".env.local") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** Where downloads and extracts live: CATALOG_DATA_DIR, else ~/trailmate-data (outside the project, never committed). */
export const dataDir = () => process.env.CATALOG_DATA_DIR || path.join(os.homedir(), "trailmate-data");

/** A polite identity for public services: the app's own (GEOCODER_USER_AGENT) or a default naming the project. */
export const userAgent = () => process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (place catalogue builder; github.com/BhanuPrasad404/trip-planner)";

/** Today in India (YYYY-MM-DD). */
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export type Manifest = {
  source: CatalogSource;
  /** The date of the DATA (OpenStreetMap extract date, or the day Wikidata was asked). */
  dataDate: string;
  rows: number;
  batches: string[];
  regions: string | null;
  madeAt: string;
  /** Counts per kind, and anything worth knowing about the run. */
  stats: Record<string, unknown>;
};

export const BATCH_ROWS = 1000;

export function writeExtract(dir: string, source: CatalogSource, dataDate: string, rows: CatalogRow[], stats: Record<string, unknown>, regions: RegionShape[] | null = null): Manifest {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (/^rows-\d+\.json$/.test(f)) writeFileSync(path.join(dir, f), "[]"); // never leave an old batch looking current
  const batches: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const name = `rows-${String(batches.length + 1).padStart(4, "0")}.json`;
    writeFileSync(path.join(dir, name), JSON.stringify(rows.slice(i, i + BATCH_ROWS)));
    batches.push(name);
  }
  let regionsFile: string | null = null;
  if (regions) { regionsFile = "regions.json"; writeFileSync(path.join(dir, regionsFile), JSON.stringify(regions)); }
  const manifest: Manifest = { source, dataDate, rows: rows.length, batches, regions: regionsFile, madeAt: new Date().toISOString(), stats };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readManifest(dir: string): Manifest {
  const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  if ((m.source !== "osm" && m.source !== "wikidata") || !/^\d{4}-\d{2}-\d{2}$/.test(m.dataDate) || !Array.isArray(m.batches)) throw new Error(`${dir}: not a catalogue extract`);
  return m;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const countBy = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
