// Builds the ready-made example plans (lib/result/examples.ts) with LIVE free data: places from the app's place search (OpenStreetMap
// via Photon; what each name matched is printed), roads from OSRM, heights from Open-Meteo, halt towns from our GeoNames index, and the
// road line of every planned day. Writes data/examples/<slug>.json. Run: npx tsx scripts/build-examples.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { photonSearch } from "@/lib/places/photon";
import { getRoute } from "@/lib/eta";
import { getMatrix } from "@/lib/routing";
import { runEngine } from "@/lib/server/trip-engine";
import { dayPoints, type ResultData } from "@/lib/result/model";
import type { PlaceCategory } from "@/lib/categories";
import type { BuilderInput, BuilderPlace } from "@/lib/trip-builder/types";

const TODAY = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
type Spec = { slug: string; title: string; blurb: string; start: string; days: number; endMode: "start" | "place" | "open"; intake: Record<string, unknown>; places: { q: string; category: PlaceCategory }[] };

const SPECS: Spec[] = [
  { slug: "chennai-puducherry", title: "Chennai → Mahabalipuram → Puducherry", blurb: "2 days by car · temples, a fort and the sea", start: "Chennai", days: 2, endMode: "open", intake: { pace: "balanced", month: 1, interests: ["history", "beaches"] },
    places: [{ q: "Shore Temple Mahabalipuram", category: "temple" }, { q: "Auroville", category: "other" }, { q: "Rock Beach Puducherry", category: "beach" }, { q: "Gingee Fort", category: "fort" }] },
  { slug: "kochi-munnar-alleppey", title: "Kochi → Munnar → Alleppey", blurb: "4 days by car · tea hills, a dam, backwaters and a beach", start: "Kochi", days: 4, endMode: "start", intake: { pace: "balanced", month: 12, interests: ["nature"] },
    places: [{ q: "Munnar", category: "hill_station" }, { q: "Mattupetty Dam", category: "lake" }, { q: "Eravikulam National Park", category: "wildlife" }, { q: "Alappuzha", category: "lake" }, { q: "Marari Beach", category: "beach" }] },
];

const pause = () => new Promise((r) => setTimeout(r, 900)); // fair use of the free Photon server
async function find(q: string) {
  const h = (await photonSearch(q, null))[0];
  await pause();
  if (!h) throw new Error(`Not found on the map: ${q}`);
  return h;
}

async function main() {
  mkdirSync("data/examples", { recursive: true });
  for (const s of SPECS) {
    const st = await find(s.start);
    const start = { lat: st.lat, lng: st.lng, label: st.name };
    const found = [];
    for (const p of s.places) found.push({ ...p, hit: await find(p.q) });
    const places: BuilderPlace[] = found.map((f, i) => ({ id: `ex${i + 1}`, name: f.hit.name, lat: f.hit.lat, lng: f.hit.lng, category: f.category, priority: "normal", hours: null }));
    for (const f of found) console.log(`${s.slug}: ${f.q} → ${f.hit.name}, ${f.hit.area} (${f.hit.lat.toFixed(3)}, ${f.hit.lng.toFixed(3)})`);
    const endMode = s.endMode === "start" ? "start" : "free";
    const matrix = await getMatrix([start, ...places]);
    if (matrix.source !== "osrm") throw new Error("Roads service unavailable: not saving an estimated example.");
    const base: BuilderInput = { places, start, end: null, endMode, numDays: s.days, startDateISO: null, utcOffsetMin: 330, matrix };
    const run = await runEngine(base, { intake: s.intake, todayISO: TODAY });
    const data: ResultData = { options: run.plan.variants.map((v) => v.option), engine: run.view, places: places.map(({ id, name, lat, lng }) => ({ id, name, lat, lng })), start, end: null };
    const lines: Record<string, Record<string, [number, number][]>> = {};
    for (const o of data.options) {
      lines[o.style] = {};
      for (const d of dayPoints(data, o.style)) {
        const r = await getRoute(d.points);
        lines[o.style][String(d.day)] = r.source === "osrm" ? r.line : d.points.map((p) => [p.lng, p.lat]);
      }
    }
    const file = `data/examples/${s.slug}.json`;
    writeFileSync(file, JSON.stringify({ slug: s.slug, title: s.title, blurb: s.blurb, built: TODAY, days: s.days, endMode: s.endMode, intake: s.intake, places: found.map((f) => ({ name: f.hit.name, lat: f.hit.lat, lng: f.hit.lng, category: f.category, area: f.hit.area })), data, lines }));
    console.log(`wrote ${file}: ${data.options.map((o) => `${o.label} ${o.totals.places}/${places.length}`).join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
