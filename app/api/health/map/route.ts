import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { noteOverpassFailure, noteOverpassOk, overpassEndpoints } from "@/lib/overpass-health";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { classifyMapFailure } from "@/lib/explore/failure";

export const maxDuration = 60;

export type MapServerCheck = { host: string; ok: boolean; ms: number; detail: string };

// "Test my map servers": asks each map-data server one tiny question and says which answered, how fast, and why one didn't, so "the map
// servers are busy" is a fact you can see instead of a guess. One tiny question per server, a few times an hour.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`map-test:${user.id}`, 5, 10 * 60_000)) return jsonError("You've tested enough for now. Try again in a few minutes.", 429);

  const query = "data=" + encodeURIComponent('[out:json][timeout:10];nwr["tourism"="attraction"]["name"](around:3000,15.4909,73.8278);out center 1;');
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)" };
  const checks: MapServerCheck[] = [];
  // Every server is asked, even one paused after a recent failure: this is the "try now" button. The answers update the shared outage
  // memory (lib/overpass-health.ts), so a server that is back is used again at once.
  for (const url of overpassEndpoints()) {
    const host = new URL(url).host, started = Date.now();
    let check: MapServerCheck;
    try {
      const res = await fetch(url, { method: "POST", headers, body: query, signal: AbortSignal.timeout(12_000) });
      const ms = Date.now() - started;
      const json = res.ok ? ((await res.json().catch(() => null)) as { remark?: string } | null) : null;
      if (!res.ok) check = { host, ok: false, ms, detail: `HTTP ${res.status}` };
      else if (json?.remark && /(timed out|out of memory|too many requests|rate_limited)/i.test(json.remark)) check = { host, ok: false, ms, detail: json.remark.slice(0, 80) };
      else check = { host, ok: true, ms, detail: "answered" };
    } catch (e) {
      check = { host, ok: false, ms: Date.now() - started, detail: e instanceof Error ? (e.name === "TimeoutError" ? "TimeoutError" : e.message.slice(0, 80)) : "error" };
    }
    if (check.ok) noteOverpassOk(url); else noteOverpassFailure(url, check.detail);
    checks.push(check);
  }
  const ok = checks.filter((c) => c.ok);
  const failure = ok.length === 0 ? classifyMapFailure(`all map servers failed: ${checks.map((c) => `${c.host} -> ${c.detail}`).join("; ")}`) : null;
  const live = ok.length === 0 ? `No map server answered. ${failure!.hint}` : ok.length === checks.length ? `All ${checks.length} map servers answered (fastest ${Math.min(...ok.map((c) => c.ms))} ms).` : `${ok.length} of ${checks.length} map servers answered; lookups will use the ones that did.`;
  const catalog = await catalogLine();
  // With the place catalogue loaded, Explore and "Plan it for me" don't need the live servers: they are only an extra.
  const message = catalog.loaded ? `${catalog.text} Live map servers (an extra only): ${live}` : `${catalog.text} ${live}`;
  return NextResponse.json({ ok: catalog.loaded || ok.length > 0, message, checks, catalog: catalog.rows }, { headers: { "Cache-Control": "private, no-store" } });
}

type StatusRow = { source: string; data_date: string | null; rows_loaded: number | null; places: number; regions: number };
/** What our own place catalogue holds, from which data, in words. */
async function catalogLine(): Promise<{ loaded: boolean; text: string; rows: StatusRow[] }> {
  if (!hasAdminAccess()) return { loaded: false, text: "Place catalogue: can't check (SUPABASE_SERVICE_ROLE_KEY isn't set).", rows: [] };
  const { data, error } = await createAdminClient().rpc("catalog_status");
  if (error) return { loaded: false, text: `Place catalogue: not available (${error.message.slice(0, 120)}). Apply the migration and load it: see docs/PLACE_CATALOG.md.`, rows: [] };
  const rows = (data ?? []) as StatusRow[];
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const of = (s: string) => rows.find((r) => r.source === s && r.data_date);
  const parts = [of("osm") && `OpenStreetMap data of ${day(of("osm")!.data_date!)}`, of("wikidata") && `Wikidata of ${day(of("wikidata")!.data_date!)}`].filter(Boolean);
  const places = Number(rows[0]?.places ?? 0), regions = Number(rows[0]?.regions ?? 0);
  if (!parts.length || places === 0) return { loaded: false, text: "Place catalogue: empty, so Explore and \"Plan it for me\" ask the live map servers. Load it: see docs/PLACE_CATALOG.md.", rows };
  return { loaded: true, text: `Place catalogue: ${places.toLocaleString("en-IN")} places (${parts.join(", ")}), ${regions} state borders.`, rows };
}
