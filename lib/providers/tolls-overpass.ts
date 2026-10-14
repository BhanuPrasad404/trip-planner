// Toll booths along a route, from OpenStreetMap via the public Overpass API.
//
// IMPORTANT (fair use): Overpass is a free shared service. This is called ONCE per route (never per GPS reading), the answer is cached by
// the caller, and a long route is asked for in small pieces. For heavy traffic, move toll plazas into the POI tile store (lib/poi), which
// needs a database change (new kind and group) and your approval; set OVERPASS_URL to your own Overpass server to avoid the public ones.
import { clusterTolls, parseTollBooths, simplifyLine, type LngLat, type OsmToll } from "@/lib/trip/toll";
import type { Vehicle } from "@/lib/vehicle";

const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
/** Points per query, and how close (m) to the road a booth must be to be returned. The client re-checks against the exact road. */
export const CHUNK_POINTS = 250;
export const CORRIDOR_M = 80;
export const MAX_CHUNKS = 8;

export const tollQuery = (chunk: LngLat[]): string => {
  const poly = chunk.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(",");
  return `[out:json][timeout:25];(node["barrier"="toll_booth"](around:${CORRIDOR_M},${poly});node["highway"="toll_gantry"](around:${CORRIDOR_M},${poly}););out body 300;`;
};

/** Split the road into overlapping pieces so each query stays small. */
export function chunkLine(line: LngLat[], size = CHUNK_POINTS): LngLat[][] {
  if (line.length <= size) return [line];
  const out: LngLat[][] = [];
  for (let i = 0; i < line.length - 1; i += size - 1) out.push(line.slice(i, i + size));
  return out;
}

const isFailureRemark = (json: unknown) => { const r = (json as { remark?: unknown } | null)?.remark; return typeof r === "string" && /(timed out|out of memory|too many requests|rate_limited)/i.test(r); };

async function askOverpass(query: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  const endpoints = [process.env.OVERPASS_URL, ...MIRRORS].filter((u): u is string => !!u);
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)" };
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, { method: "POST", headers, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const json = await res.json();
      if (isFailureRemark(json)) continue;
      return json;
    } catch { /* try the next server */ }
  }
  return null;
}

export type TollLookup = { tolls: OsmToll[]; /** False when some piece of the route could not be checked: the list may be missing plazas. */ complete: boolean };

/** Every toll plaza within a short distance of the road. Throws only when NOTHING could be checked. */
export async function fetchTollsAlong(line: LngLat[], fetchImpl: typeof fetch = fetch, vehicle: Vehicle = "car"): Promise<TollLookup> {
  const simple = simplifyLine(line, 40);
  const chunks = chunkLine(simple);
  if (chunks.length > MAX_CHUNKS) throw new Error("route too long to check for tolls");
  const found: OsmToll[] = [];
  let ok = 0;
  for (const c of chunks) {
    const json = await askOverpass(tollQuery(c), fetchImpl);
    if (json === null) continue;
    ok++;
    found.push(...parseTollBooths(json, vehicle));
  }
  if (ok === 0) throw new Error("toll data unavailable");
  const unique = [...new Map(found.map((t) => [t.id, t])).values()];
  return { tolls: clusterTolls(unique), complete: ok === chunks.length };
}
