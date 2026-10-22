// Phase 3 sample trips, planned with LIVE free data and printed in plain words.
//   Places: the app's own place search — OpenStreetMap through Photon first (it knows sights like "Borra Caves"), our GeoNames index
//   second. What each name matched is printed, so a wrong match is visible.
//   Roads: OSRM (road network, no traffic). Heights: Open-Meteo. Weather: Open-Meteo (forecast ≤ 16 days, else typical). Towns: GeoNames.
//   Tolls: OpenStreetMap via Overpass (count only, never fees). Opening hours: none known for these places, and the output says so.
// Run: npx tsx scripts/engine-samples.ts > engine-samples.txt
import { describePlan } from "@/lib/engine/describe";
import { computeGoScore } from "@/lib/goscore";
import { getMatrix } from "@/lib/routing";
import { getSeasonStatus } from "@/lib/season";
import { dateOfTripDay } from "@/lib/dates";
import { distanceKm } from "@/lib/geo";
import { searchIndex } from "@/lib/places/geo-index";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { photonSearch } from "@/lib/places/photon";
import { weatherProvider } from "@/lib/providers/registry";
import { runEngine } from "@/lib/server/trip-engine";
import type { PlaceCategory } from "@/lib/categories";
import type { Priority } from "@/lib/trip-builder/config";
import type { BuilderInput, BuilderPlace, EndMode } from "@/lib/trip-builder/types";
import type { Conditions } from "@/lib/weather";

type P = { q: string; category: PlaceCategory; priority?: Priority };
type Trip = { title: string; start: string; places: P[]; days: number; date: string | null; endMode: EndMode; end?: string; intake: Record<string, unknown> };

const TODAY = "2026-10-22";
const TRIPS: Trip[] = [
  { title: "1. Hyderabad → Araku, Borra Caves, Lambasingi · 3 days · round trip", start: "Hyderabad", days: 3, date: "2026-12-18", endMode: "start", intake: { pace: "balanced" },
    places: [{ q: "Araku Valley", category: "hill_station" }, { q: "Borra Caves", category: "viewpoint" }, { q: "Lambasingi", category: "hill_station" }] },
  { title: "2. Hyderabad → Manali · 8 days · round trip (needs drive days)", start: "Hyderabad", days: 8, date: "2027-05-15", endMode: "start", intake: { pace: "balanced" },
    places: [{ q: "Hadimba Temple", category: "temple" }, { q: "Solang Valley", category: "viewpoint" }, { q: "Rohtang Pass", category: "viewpoint" }, { q: "Naggar Castle", category: "fort" }, { q: "Kasol", category: "hill_station" }] },
  { title: "3. Hyderabad weekend with too many places · 2 days (does NOT fit)", start: "Hyderabad", days: 2, date: "2026-11-07", endMode: "start", intake: { pace: "balanced" },
    places: [{ q: "Golconda Fort", category: "fort" }, { q: "Charminar", category: "fort" }, { q: "Ramoji Film City", category: "activity" }, { q: "Bhongir Fort", category: "fort" }, { q: "Yadagirigutta", category: "temple" }, { q: "Vikarabad", category: "hill_station" }, { q: "Bhoodan Pochampally", category: "other" }, { q: "Thousand Pillar Temple", category: "temple" }, { q: "Ramappa Temple", category: "temple", priority: "must" }] },
  { title: "4. Bengaluru → Coorg and Chikmagalur · December · 3 days · night driving refused", start: "Bengaluru", days: 3, date: "2026-12-26", endMode: "start", intake: { pace: "packed", night_driving: false },
    places: [{ q: "Madikeri", category: "hill_station" }, { q: "Abbey Falls Madikeri", category: "waterfall" }, { q: "Dubare Elephant Camp", category: "wildlife" }, { q: "Mullayanagiri", category: "viewpoint" }, { q: "Baba Budangiri", category: "viewpoint" }, { q: "Chikmagalur", category: "hill_station" }] },
  { title: "5. Kochi → Munnar → Alleppey · with elders · 4 days · round trip", start: "Kochi", days: 4, date: "2026-11-12", endMode: "start", intake: { pace: "relaxed", group: "family_elders" },
    places: [{ q: "Munnar", category: "hill_station" }, { q: "Mattupetty Dam", category: "lake" }, { q: "Eravikulam National Park", category: "wildlife" }, { q: "Alappuzha", category: "lake" }, { q: "Marari Beach", category: "beach" }] },
  { title: "6. Pune → Goa one way · by bike · 3 days", start: "Pune", days: 3, date: "2026-11-20", endMode: "point", end: "Panaji", intake: { pace: "balanced", mode: "bike", max_drive_hours: 5 },
    places: [{ q: "Mahabaleshwar Satara", category: "hill_station" }, { q: "Mahalaxmi Temple Kolhapur", category: "temple" }, { q: "Calangute Beach", category: "beach" }, { q: "Fort Aguada", category: "fort" }] },
  { title: "7. Chennai → Mahabalipuram → Puducherry · open end · 2 days", start: "Chennai", days: 2, date: "2026-10-31", endMode: "free", intake: { pace: "balanced", interests: ["history", "beaches"] },
    places: [{ q: "Shore Temple Mahabalipuram", category: "temple" }, { q: "Auroville", category: "other" }, { q: "Rock Beach Puducherry", category: "beach" }, { q: "Gingee Fort", category: "fort" }] },
  { title: "8. Vizag circuit · must-see Simhachalam · ends in Rajahmundry · 2 days", start: "Visakhapatnam", days: 2, date: "2026-11-01", endMode: "point", end: "Rajahmundry", intake: { pace: "balanced" },
    places: [{ q: "Simhachalam Temple", category: "temple", priority: "must" }, { q: "Kailasagiri Visakhapatnam", category: "viewpoint" }, { q: "Bheemunipatnam", category: "beach" }, { q: "Yarada Beach", category: "beach" }, { q: "Sri Veera Venkata Satyanarayana Swamy Temple Annavaram", category: "temple" }] },
];

async function main() {
  const ix = await loadGeoIndex();
  if (!ix) throw new Error("GeoNames index missing");
  const out: string[] = [`Trailmate Phase 3 sample trips — planned ${TODAY} with live free data (OSRM roads, Open-Meteo heights and weather, GeoNames towns, OpenStreetMap tolls).`, ""];
  for (const t of TRIPS) {
    const t0 = Date.now();
    const s = searchIndex(ix, t.start, { limit: 1 })[0];
    const start = { lat: s.lat, lng: s.lng, label: s.name };
    const matched: string[] = [];
    const places: BuilderPlace[] = [];
    for (const [i, p] of t.places.entries()) {
      const fromMap = (await photonSearch(p.q, null).catch(() => []))[0];
      await new Promise((r) => setTimeout(r, 800)); // fair use of the free Photon server
      // The index fallback only counts near the trip (a same-named village 800 km away is not the place meant).
      const local = searchIndex(ix, p.q, { near: start, limit: 1 })[0];
      const h = fromMap ?? (local && distanceKm(start, local) <= 400 ? local : undefined);
      if (!h) { matched.push(`${p.q} → NOT FOUND (left out of this sample)`); continue; }
      matched.push(`${p.q} → ${h.name}, ${h.area} (${h.lat.toFixed(3)}, ${h.lng.toFixed(3)}) [${fromMap ? "OpenStreetMap" : "GeoNames"}]`);
      places.push({ id: `p${i + 1}`, name: h.name, lat: h.lat, lng: h.lng, category: p.category, priority: p.priority ?? "normal", hours: null });
    }
    const endHit = t.end ? (await photonSearch(t.end, null).catch(() => []))[0] ?? searchIndex(ix, t.end, { limit: 1 })[0] : null;
    const end = endHit ? { lat: endHit.lat, lng: endHit.lng, label: endHit.name } : null;
    const matrix = await getMatrix([start, ...places, ...(t.endMode === "point" && end ? [end] : [])]);
    if (t.date && places.length * t.days <= 120) {
      const req = places.flatMap((p) => Array.from({ length: t.days }, (_, k) => ({ id: `${p.id}|${k + 1}`, lat: p.lat, lng: p.lng, date: dateOfTripDay(t.date, k + 1)! })));
      const cond = (await weatherProvider().conditionsFor(req, TODAY).catch(() => ({}))) as Record<string, Conditions>;
      for (const p of places) {
        p.fit = []; p.fitNote = [];
        for (let d = 1; d <= t.days; d++) {
          const c = cond[`${p.id}|${d}`] ?? null;
          const date = dateOfTripDay(t.date, d)!;
          p.fit.push(c ? computeGoScore({ category: p.category, seasonStatus: getSeasonStatus(undefined, date.getMonth() + 1), conditions: c })?.score ?? null : null);
          p.fitNote.push(c ? `${Math.round(c.tempMaxC)}°C, ~${c.precipMmPerDay < 1 ? "<1" : Math.round(c.precipMmPerDay)} mm rain` : null);
        }
      }
    }
    const base: BuilderInput = { places, start, end: t.endMode === "point" ? end : null, endMode: t.endMode, numDays: t.days, startDateISO: t.date, utcOffsetMin: 330, matrix };
    const run = await runEngine(base, { intake: t.intake, todayISO: TODAY });
    out.push("=".repeat(100), t.title, `Start: ${start.label} · ${t.date ?? "no dates"} · traveller said: ${JSON.stringify(t.intake)}`, "Places (matched by the app's place search):", ...matched.map((m) => `  ${m}`));
    out.push(`Live data: roads ${matrix.source}${matrix.estimatedPairs ? ` (${matrix.estimatedPairs} pairs estimated)` : ""}; heights ${run.input.heights ? "yes" : "unavailable"}; long-road line ${run.input.outLine ? `${run.input.outLine.coords.length} points` : "not needed / unavailable"}; planned in ${Date.now() - t0} ms including the network.`, "");
    out.push(describePlan(run.plan), "");
  }
  process.stdout.write(out.join("\n") + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
