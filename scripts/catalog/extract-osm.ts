// Step 2 of the place catalogue: the OpenStreetMap India extract from Geofabrik → rows + state borders in <data>/osm-<date>/.
//   npx tsx scripts/catalog/extract-osm.ts <path to india-YYMMDD.osm.pbf> [--force]
// Needs Docker and the osmium image (built once from Debian's own package):
//   docker build -t trailmate-osmium -f scripts/catalog/osmium.Dockerfile scripts/catalog
// osmium keeps only the tags our place kinds use (lib/catalog/osm.ts OSMIUM_FILTERS) and the state boundaries, and writes them as
// GeoJSON lines; this script then reads them one line at a time (the whole of India never sits in memory as JSON), classifies every
// place with the SAME rules as the live map search, drops unnamed ones and joins duplicates.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { Deduper, featureToRow, OSMIUM_FILTERS, type OsmFeature } from "@/lib/catalog/osm";
import { regionShapes } from "@/lib/catalog/regions";
import { REGIONS } from "@/lib/explore/regions";
import { countBy, dataDir, loadEnv, writeExtract } from "./common";
import { addStateCodes } from "./state-codes";

loadEnv();
const IMAGE = "trailmate-osmium";

function osmium(dir: string, args: string[]): string {
  const r = spawnSync("docker", ["run", "--rm", "-v", `${dir}:/data`, IMAGE, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`docker: ${r.error.message} (is Docker running?)`);
  if (r.status !== 0) throw new Error(`osmium ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(-800)}`);
  return r.stdout;
}

/** The extract's own date: Geofabrik writes the replication timestamp in the file header; else the date in the file name (india-261028). */
function extractDate(dir: string, file: string): string {
  try {
    const ts = osmium(dir, ["fileinfo", "-g", "header.option.osmosis_replication_timestamp", `/data/${file}`]).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) return ts.slice(0, 10);
  } catch { /* fall back to the name */ }
  const m = /(\d{2})(\d{2})(\d{2})\.osm\.pbf$/.exec(file);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  throw new Error("Couldn't tell the extract's date (no header timestamp, no date in the file name).");
}

async function* features(file: string): AsyncGenerator<OsmFeature> {
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  let bad = 0;
  for await (const raw of rl) {
    const line = raw.replace(/^\u001e/, "").trim();
    if (!line) continue;
    try { yield JSON.parse(line) as OsmFeature; } catch { if (++bad <= 3) console.warn("  skipped an unreadable line"); }
  }
}

async function main() {
  const pbf = process.argv[2];
  const force = process.argv.includes("--force");
  if (!pbf || !existsSync(pbf)) { console.error("Usage: npx tsx scripts/catalog/extract-osm.ts <india-YYMMDD.osm.pbf> [--force]"); process.exit(1); }
  const dir = path.dirname(path.resolve(pbf)), file = path.basename(pbf);
  const date = extractDate(dir, file);
  const stem = file.replace(/\.osm\.pbf$/, "");
  console.log(`extract ${file} (${(statSync(pbf).size / 1e9).toFixed(2)} GB), data date ${date}`);

  const placesPbf = `${stem}-places.osm.pbf`, placesJson = `${stem}-places.geojsonseq`;
  const regionsPbf = `${stem}-regions.osm.pbf`, regionsJson = `${stem}-regions.geojsonseq`;
  const step = (out: string, args: string[], what: string) => {
    if (!force && existsSync(path.join(dir, out))) { console.log(`  ${what}: already done (${out})`); return; }
    const t = Date.now();
    osmium(dir, args);
    console.log(`  ${what}: ${Math.round((Date.now() - t) / 1000)} s → ${out} (${(statSync(path.join(dir, out)).size / 1e6).toFixed(0)} MB)`);
  };
  step(placesPbf, ["tags-filter", `/data/${file}`, ...OSMIUM_FILTERS, "-o", `/data/${placesPbf}`, "--overwrite"], "keep place tags");
  step(placesJson, ["export", `/data/${placesPbf}`, "-f", "geojsonseq", "-x", "print_record_separator=false", "-a", "type,id", "--geometry-types=point,linestring,polygon", "-o", `/data/${placesJson}`, "--overwrite"], "export places");
  step(regionsPbf, ["tags-filter", `/data/${file}`, "r/admin_level=4", "-o", `/data/${regionsPbf}`, "--overwrite"], "keep state borders");
  step(regionsJson, ["export", `/data/${regionsPbf}`, "-f", "geojsonseq", "-x", "print_record_separator=false", "-a", "type,id", "--geometry-types=polygon", "-o", `/data/${regionsJson}`, "--overwrite"], "export state borders");

  const dedupe = new Deduper();
  let seen = 0, kept = 0;
  for await (const f of features(path.join(dir, placesJson))) {
    seen++;
    const row = featureToRow(f);
    if (row) { dedupe.add(row); kept++; }
    if (seen % 500_000 === 0) console.log(`  read ${seen.toLocaleString("en-IN")} map objects, ${kept.toLocaleString("en-IN")} usable`);
  }
  const rows = dedupe.rows();
  const { withState } = await addStateCodes(rows);
  const regionFeatures: OsmFeature[] = [];
  for await (const f of features(path.join(dir, regionsJson))) regionFeatures.push(f);
  const regions = regionShapes(regionFeatures);

  const out = path.join(dataDir(), `osm-${date}`);
  const stats = { file, withStateCode: withState, mapObjectsRead: seen, usable: kept, afterJoiningDuplicates: rows.length, perCategory: countBy(rows, (r) => r.category), notable: rows.filter((r) => r.wikidata || r.wikipedia || r.heritage).length, regions: regions.map((r) => r.code) };
  const m = writeExtract(out, "osm", date, rows, stats, regions);
  console.log(`\n${m.rows.toLocaleString("en-IN")} places, ${regions.length} state/UT borders → ${out}`);
  console.log(JSON.stringify(stats.perCategory));
  const missing = REGIONS.filter((r) => !regions.some((x) => x.code === r.code)).map((r) => r.name);
  if (missing.length) console.warn(`  no border found for: ${missing.join(", ")} ("places in this state" won't work there until it is)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
