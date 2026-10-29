import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { getPoiService } from "@/lib/poi";
import { groupsOfKinds, type PoiKind } from "@/lib/poi/types";
import { validateHours } from "@/lib/server/opening-hours";
import { matchHours, type HoursCandidate, type LookupOutcome } from "@/lib/travel/hours-match";
import { uuid } from "@/lib/validation/schemas";
import { aliasesFromTags } from "@/lib/place-intel/names";

// Stops can be sights, restaurants or stays; these are the kinds of mapped places that carry opening hours we would match to a stop.
const KINDS: PoiKind[] = ["sight", "viewpoint", "food", "cafe", "stay"];
const MAX_STOPS = 40;
const BUDGET_MS = 20_000;


/**
 * Suggest opening hours from OpenStreetMap map data for the stops that have none. Suggestions are saved as UNCONFIRMED map data:
 * they never replace hours a member typed or confirmed, and nothing is invented when the map has no hours.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  // Each lookup may fetch public map data: keep it occasional.
  if (!rateLimiter.take(`hours-lookup:${user.id}`, 6, 10 * 60_000)) return jsonError("You can look up opening hours a few times every 10 minutes. Please try again shortly.", 429);

  const { data: trip, error: tripError } = await supabase.from("trips").select("id").eq("id", id).maybeSingle();
  if (tripError) return dbError(tripError, "hours lookup: trip");
  if (!trip) return jsonError("Trip not found", 404);
  const { data: rows, error } = await supabase.from("places").select("id, name, lat, lng, opening_hours, hours_source, hours_confirmed_at").eq("trip_id", id).order("day_number", { ascending: true, nullsFirst: false }).order("sequence_order", { ascending: true }).limit(300);
  if (error) return dbError(error, "hours lookup: places");

  const outcomes: LookupOutcome[] = [];
  const wanted = (rows ?? []).filter((r) => !r.opening_hours || (r.hours_source === "map_data" && !r.hours_confirmed_at));
  for (const r of rows ?? []) if (!wanted.includes(r)) outcomes.push({ placeId: r.id as string, result: "kept" });

  const svc = getPoiService();
  const started = Date.now();
  for (const r of wanted.slice(0, MAX_STOPS)) {
    const placeId = r.id as string;
    const stop = { name: r.name as string, lat: r.lat as number, lng: r.lng as number };
    if (Date.now() - started > BUDGET_MS) { outcomes.push({ placeId, result: "map_loading" }); continue; }
    let pending = false;
    try {
      const line: [number, number][] = [[stop.lng, stop.lat], [stop.lng + 0.0001, stop.lat]];
      const cov = await svc.ensureCoverage(line, 0.6, groupsOfKinds(KINDS), { syncBudget: 1 });
      pending = cov.ready < cov.total;
    } catch { pending = true; }
    const near = await svc.store.near(stop.lat, stop.lng, 600, KINDS, 60).catch(() => []);
    const candidates: HoursCandidate[] = near.map((p) => ({ ref: `${p.source}/${p.source_id}`.slice(0, 64), name: p.name, lat: p.lat, lng: p.lng, hours: p.tags.opening_hours ?? null, fetchedAt: p.fetched_at,
      aliases: aliasesFromTags(p.tags), ids: { osm: p.source === "osm" ? p.source_id : null, wikidata: p.tags.wikidata ?? null } }));
    const m = matchHours(stop, candidates);
    if (m.kind === "ambiguous") { outcomes.push({ placeId, result: "ambiguous", names: m.names }); continue; }
    if (m.kind === "none") { outcomes.push({ placeId, result: pending ? "map_loading" : "none" }); continue; }
    const v = validateHours(m.candidate.hours!, stop);
    if (!v.ok) { outcomes.push({ placeId, result: "unreadable" }); continue; }
    // Never overwrite hours a member typed or confirmed, even if they did so while this lookup ran.
    const { data: saved, error: saveError } = await supabase
      .from("places")
      .update({ opening_hours: v.value, hours_source: "map_data", hours_ref: m.candidate.ref, hours_fetched_at: m.candidate.fetchedAt ?? new Date().toISOString(), hours_confirmed_at: null })
      .eq("id", placeId)
      .or("opening_hours.is.null,and(hours_source.eq.map_data,hours_confirmed_at.is.null)")
      .select("id");
    if (saveError) return dbError(saveError, "hours lookup: save");
    outcomes.push(saved && saved.length ? { placeId, result: "found", name: m.candidate.name!, hours: v.value, ref: m.candidate.ref, distanceM: m.distanceM } : { placeId, result: "kept" });
  }
  for (const r of wanted.slice(MAX_STOPS)) outcomes.push({ placeId: r.id as string, result: "map_loading" });
  return NextResponse.json({ outcomes }, { headers: { "Cache-Control": "private, no-store" } });
}
