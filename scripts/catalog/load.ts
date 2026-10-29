// Step 3 of the place catalogue: send one extract folder to the database (Supabase, with the service role key from .env.local).
//   npx tsx scripts/catalog/load.ts <data folder, e.g. ~/trailmate-data/osm-2026-10-28> [--prune]
// Every run is written to catalog_loads (running → ok / failed). A batch that fails is tried again (3 times, waiting longer each time);
// if any batch still fails the run is marked failed and NOTHING is pruned. --prune (after a complete, ok load only) takes away what
// this source no longer has (see catalog_prune in the migration). Loading the same folder twice is safe: rows are merged, not duplicated.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { RegionShape } from "@/lib/catalog/regions";
import { rowOk, type CatalogRow } from "@/lib/catalog/types";
import { loadEnv, readManifest, sleep } from "./common";

loadEnv();

async function main() {
  const dir = process.argv[2];
  const prune = process.argv.includes("--prune");
  if (!dir) { console.error("Usage: npx tsx scripts/catalog/load.ts <extract folder> [--prune]"); process.exit(1); }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const m = readManifest(dir);
  console.log(`loading ${m.source} data of ${m.dataDate}: ${m.rows} places in ${m.batches.length} batches${m.regions ? " + state borders" : ""} → ${new URL(url).host}`);

  const retry = async <T,>(what: string, f: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      const { data, error } = await f();
      if (!error) return data;
      if (attempt >= 3) throw new Error(`${what}: ${error.message}`);
      console.log(`  ${what}: ${error.message}; trying again`);
      await sleep(2_000 * attempt * attempt);
    }
  };

  const log = await retry("start the load log", () => db.from("catalog_loads").insert({ source: m.source, data_date: m.dataDate, status: "running" }).select("id").single());
  const logId = (log as { id: number }).id;
  const finish = (status: "ok" | "failed", rows: number, note: string | null) =>
    retry("finish the load log", () => db.from("catalog_loads").update({ status, rows_loaded: rows, note: note?.slice(0, 500) ?? null, finished_at: new Date().toISOString() }).eq("id", logId));

  let loaded = 0;
  try {
    if (m.regions) {
      const regions = JSON.parse(readFileSync(path.join(dir, m.regions), "utf8")) as RegionShape[];
      const rlog = await retry("start the borders log", () => db.from("catalog_loads").insert({ source: "regions", data_date: m.dataDate, status: "running" }).select("id").single());
      for (const r of regions) await retry(`border ${r.code}`, () => db.rpc("catalog_set_region", { _code: r.code, _name: r.name, _geojson: r.geometry, _date: m.dataDate }));
      await retry("finish the borders log", () => db.from("catalog_loads").update({ status: "ok", rows_loaded: regions.length, finished_at: new Date().toISOString() }).eq("id", (rlog as { id: number }).id));
      console.log(`  ${regions.length} state/UT borders`);
    }
    for (const [i, b] of m.batches.entries()) {
      const rows = (JSON.parse(readFileSync(path.join(dir, b), "utf8")) as CatalogRow[]).filter(rowOk);
      if (!rows.length) continue;
      const n = await retry(`batch ${b}`, () => db.rpc("catalog_merge", { _rows: rows, _source: m.source, _date: m.dataDate }));
      loaded += Number(n) || 0;
      if ((i + 1) % 20 === 0 || i === m.batches.length - 1) console.log(`  ${i + 1}/${m.batches.length} batches, ${loaded.toLocaleString("en-IN")} places`);
    }
    let pruned: number | null = null;
    if (prune) pruned = Number(await retry("prune", () => db.rpc("catalog_prune", { _source: m.source, _date: m.dataDate })));
    // Each place's state (border, else state code): "places in this state" reads it. Run after every load, prune included.
    let after: string | null = "", pages = 0;
    while (after !== null) {
      const from: string = after;
      after = (await retry("assign states", () => db.rpc("catalog_assign_regions", { _after: from, _limit: 10_000 }))) as string | null;
      pages++;
    }
    console.log(`  states worked out (${pages} pages)`);
    await finish("ok", loaded, pruned === null ? null : `pruned ${pruned} rows older than ${m.dataDate}`);
    console.log(`done: ${loaded.toLocaleString("en-IN")} places loaded${pruned === null ? " (not pruned: add --prune after a complete load)" : `, ${pruned} old rows taken off`}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("failed", loaded, msg).catch(() => undefined);
    throw new Error(`load FAILED after ${loaded} places (nothing pruned): ${msg}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
