import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { AiNotConfiguredError, AiRequestError, PROVIDER_NAME, callTool } from "@/lib/ai/client";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { aiProviderId, diagnoseAi } from "@/lib/config";
import { nominatimGeocoder } from "@/lib/geocode";
import { runImport, type FitRunner } from "@/lib/import/pipeline";
import { getMatrix } from "@/lib/routing";
import { evaluateBrief, type BriefCandidate } from "@/lib/trip-builder/brief";
import { normalizeCategory } from "@/lib/categories";
import { resolveShortMapsUrl, stripUrls } from "@/lib/maps-url";
import { consumeQuota, importDailyLimit } from "@/lib/quota";
import { importSchema } from "@/lib/validation/schemas";

export const maxDuration = 60; // geocoding is throttled to ~1 req/s, so big imports take a while

// Turns pasted text / Maps links / screenshots / a trip brief into REVIEWABLE place candidates.
// Nothing is saved here — the user approves candidates first (POST /api/places/bulk).
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  if (Number(req.headers.get("content-length") ?? 0) > 12_000_000) return jsonError("Request is too large", 413);
  const { data: input, error: bodyError } = await parseBody(req, importSchema);
  if (bodyError) return bodyError;

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, start_city, start_lat, start_lng, dest_name, dest_lat, dest_lng, start_date, num_days")
    .eq("id", input.trip_id)
    .maybeSingle();
  if (tripError) return dbError(tripError, "import: load trip");
  if (!trip) return jsonError("Trip not found", 404);

  if (input.mode === "suggest" && input.text.length < 10) return jsonError("Describe your trip in a sentence or two", 400);
  if (input.mode === "extract" && !input.text && input.images.length === 0) return jsonError("Paste some text, a link, or add a screenshot", 400);

  // Only AI-backed work is metered; plain Maps-link imports are free.
  const usesAi = input.mode === "suggest" || input.images.length > 0 || stripUrls(input.text).length >= 15;
  if (usesAi) {
    const ok = await consumeQuota(supabase, "ai_import", importDailyLimit());
    if (!ok) return jsonError("You've reached today's AI import limit. Maps-link imports still work, and the limit resets within 24 hours.", 429);
  }

  const [{ data: tags, error: tagsError }, { data: existing }] = await Promise.all([
    supabase.from("season_tags").select("id, place_name, lat, lng, category, good_months, reason"),
    supabase.from("places").select("name, lat, lng").eq("trip_id", trip.id),
  ]);
  if (tagsError) return dbError(tagsError, "import: load season tags");

  // "Describe my trip": the feasibility check. Needs a start point; routing falls back to estimates (and says so) if the service is down.
  const startPoint = trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat as number, lng: trip.start_lng as number, label: (trip.start_city as string | null) ?? "your start" } : null;
  const fit: FitRunner | undefined = startPoint
    ? async ({ candidates, constraints }) => {
        const existingRows: BriefCandidate[] = (existing ?? []).slice(0, 30).map((e, i) => ({ id: `existing-${i}`, name: e.name as string, lat: e.lat as number, lng: e.lng as number, category: normalizeCategory(null), confidence: 1, existing: true }));
        const fresh: BriefCandidate[] = candidates
          .filter((c) => c.lat != null && c.lng != null && !c.duplicate)
          .map((c) => ({ id: c.key, name: c.name, lat: c.lat as number, lng: c.lng as number, category: c.category, confidence: c.confidence }));
        const all = [...existingRows, ...fresh];
        if (all.length === 0) return null;
        const matrix = await getMatrix([startPoint, ...all]);
        const result = evaluateBrief({
          candidates: all, start: startPoint, numDays: Math.max(1, Math.floor(trip.num_days as number)), startDateISO: (trip.start_date as string | null) ?? null,
          utcOffsetMin: 330, constraints, matrix,
        });
        // Stops already on the trip are not part of the list the traveller is reviewing; keep them out of the per-candidate answer.
        const isExisting = (id: string) => id.startsWith("existing-");
        return { ...result, dropped: result.dropped.filter((d) => !isExisting(d.id)) };
      }
    : undefined;

  try {
    const result = await runImport(
      {
        mode: input.mode,
        text: input.text,
        images: input.images.map((d) => {
          const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(d)!;
          return { media_type: m[1], data: m[2] };
        }),
        // Bias toward where the trip is GOING (stops are near the destination, not the start city).
        bias:
          trip.dest_lat != null && trip.dest_lng != null
            ? { lat: trip.dest_lat, lng: trip.dest_lng }
            : trip.start_lat != null && trip.start_lng != null
              ? { lat: trip.start_lat, lng: trip.start_lng }
              : null,
        biasLabel: trip.dest_name ?? trip.start_city,
        context: { startCity: trip.start_city, destination: trip.dest_name, startDate: trip.start_date, numDays: trip.num_days },
        seasonTags: tags ?? [],
        existing: existing ?? [],
      },
      { llm: callTool, geocode: nominatimGeocoder, resolveUrl: (u) => resolveShortMapsUrl(u), fit }
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      // Say exactly WHY the running server has no key and what to do about it (never the key itself).
      const d = diagnoseAi();
      return NextResponse.json(
        { error: `AI import isn't set up on this server yet (missing ${err.envName}). ${d.problem ?? ""} ${d.fix ?? ""} Google Maps links still work.`.replace(/\s+/g, " ").trim(), code: "ai_not_configured" },
        { status: 503 }
      );
    }
    if (err instanceof AiRequestError) {
      if (err.status === 401 || err.status === 403) return NextResponse.json({ error: `The ${PROVIDER_NAME[aiProviderId()]} key was rejected (invalid or revoked). Create a new key with the provider, update it in your environment settings, and restart the server.`, code: "ai_key_rejected" }, { status: 503 });
      if (err.status === 429) return jsonError("The AI service is rate-limiting this key right now (free keys have low limits). Please try again in a minute.", 429);
      return jsonError("The AI service had a problem. Please try again in a moment.", 502);
    }
    console.error("[import] unexpected:", err);
    return jsonError("Something went wrong while importing. Please try again.", 500);
  }
}
