// Step 1 of the place catalogue: ask Wikidata for every place in India of each place TYPE (lib/catalog/wikidata.ts), politely, one
// question at a time, and write the rows to <data>/wikidata-<date>/ for the load step.
//   npx tsx scripts/catalog/extract-wikidata.ts
// No new tool: plain HTTPS to the public Wikidata query service. A type too big for one question is asked in quarters of India (then
// quarters of those), never in parallel. "Too many requests" waits as long as the service asks. The run stops if any type id no longer
// has the label we expect (a wrong id would quietly load the wrong things).
import path from "node:path";
import { EXCLUDED_ROOTS, INDIA_WD_BOX, ROOTS, expectedLabels, mergeRows, parseAnswer, quarters, rootQuery, type Box, type Root } from "@/lib/catalog/wikidata";
import type { CatalogRow } from "@/lib/catalog/types";
import { countBy, dataDir, loadEnv, sleep, todayIST, userAgent, writeExtract } from "./common";
import { addStateCodes } from "./state-codes";

loadEnv();
const SPARQL = "https://query.wikidata.org/sparql";
const API = "https://www.wikidata.org/w/api.php";
const PAUSE_MS = 1_500;          // between questions: the service asks for one at a time from a script
const TIMEOUT_MS = 70_000;       // the service itself stops a question after 60 s
const MAX_DEPTH = 3;             // India → quarters → sixteenths → 64ths
const MAX_TRIES = 5;

async function politeFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), "User-Agent": userAgent() }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e: Error) => e);
    if (res instanceof Response && res.status !== 429) return res;
    if (attempt >= MAX_TRIES) { if (res instanceof Response) return res; throw res; }
    const wait = res instanceof Response ? Math.min(300, Number(res.headers.get("retry-after")) || 30 * attempt) * 1000 : 10_000 * attempt;
    console.log(`  … ${res instanceof Response ? "too many requests" : res.name}: waiting ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
}

async function verifyRoots(): Promise<void> {
  const want = expectedLabels();
  const ids = Object.keys(want);
  for (let i = 0; i < ids.length; i += 50) {
    const url = `${API}?action=wbgetentities&ids=${ids.slice(i, i + 50).join("|")}&props=labels&languages=en&format=json`;
    const res = await politeFetch(url, {});
    const json = (await res.json()) as { entities?: Record<string, { labels?: { en?: { value: string } } }> };
    for (const id of ids.slice(i, i + 50)) {
      const got = json.entities?.[id]?.labels?.en?.value;
      if (got !== want[id]) throw new Error(`Wikidata type ${id} is now "${got ?? "missing"}", expected "${want[id]}": fix lib/catalog/wikidata.ts before loading.`);
    }
    await sleep(PAUSE_MS);
  }
  console.log(`checked ${ids.length} type ids against Wikidata's own labels: all as expected`);
}

/** One type over a box: the whole answer, splitting the box when the service times out. */
async function fetchRoot(root: Root, box: Box | null, depth: number, log: string[]): Promise<CatalogRow[]> {
  const res = await politeFetch(SPARQL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" }, body: `query=${encodeURIComponent(rootQuery(root, box))}` }).catch((e: Error) => e);
  await sleep(PAUSE_MS);
  const where = box ? `[${box.south},${box.west} → ${box.north},${box.east}]` : "India";
  if (res instanceof Response && res.ok) {
    const text = await res.text();
    try { return parseAnswer(JSON.parse(text), root); }
    catch { /* a timeout can arrive as a 200 with a broken body: treated like a timeout below */ }
  }
  const why = res instanceof Response ? `HTTP ${res.status}` : res.name;
  if (depth >= MAX_DEPTH) throw new Error(`${root.label} ${where}: ${why} even in the smallest box`);
  log.push(`${root.label} ${where}: ${why}, asking in quarters`);
  console.log(`  ${root.label} ${where}: ${why}, asking in quarters`);
  const out: CatalogRow[] = [];
  for (const q of quarters(box ?? INDIA_WD_BOX)) out.push(...(await fetchRoot(root, q, depth + 1, log)));
  return out;
}

async function main() {
  const date = todayIST();
  await verifyRoots();
  const lists: CatalogRow[][] = [];
  const perType: Record<string, number> = {};
  const log: string[] = [];
  const zero: string[] = [];
  for (const root of ROOTS) {
    const t = Date.now();
    const rows = await fetchRoot(root, null, 0, log);
    perType[`${root.qid} ${root.label}`] = rows.length;
    lists.push(rows);
    console.log(`${root.label.padEnd(22)} ${String(rows.length).padStart(6)} places  (${Math.round((Date.now() - t) / 1000)} s)`);
    if (rows.length === 0 && root.deep) zero.push(root.label);
  }
  // A whole kind with nothing in all of India is almost always a query problem, not a fact: say it loudly (the run still completes).
  if (zero.length) console.warn(`\nWARNING: no places at all for: ${zero.join(", ")}. Check the query before loading.`);
  const rows = mergeRows(lists);
  const { withState } = await addStateCodes(rows);
  const dir = path.join(dataDir(), `wikidata-${date}`);
  const m = writeExtract(dir, "wikidata", date, rows, { withStateCode: withState, perType, perCategory: countBy(rows, (r) => r.category), excluded: EXCLUDED_ROOTS.map((x) => x.label), splits: log });
  console.log(`\n${m.rows} places (one per Wikidata item) in ${m.batches.length} batches → ${dir}`);
  console.log(JSON.stringify(m.stats.perCategory));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
