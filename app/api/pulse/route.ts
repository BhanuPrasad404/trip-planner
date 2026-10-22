import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { buildPulse, type PulseReport } from "@/lib/intel/pulse";
import { weatherProvider } from "@/lib/providers/registry";
import { consumeQuota } from "@/lib/quota";
import { REPORT_PHOTO_BUCKET } from "@/lib/reports";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { areaOf, forecastHorizonMs } from "@/lib/forecast/areas";
import { momentAt } from "@/lib/forecast/moment";
import { pulseSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;

// Live Place Pulse for ONE place, fetched only when someone opens it (so the page never loads pulses for everything).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, pulseSchema);
  if (bodyError) return bodyError;
  if (!(await consumeQuota(supabase, "pulse", 600))) return jsonError("You've looked at a lot of places today. Please try again tomorrow.", 429);

  const nowMs = Date.now();
  const pad = 0.003; // ≈ 330 m: reports made at (or right next to) this place
  const [{ data: rows }, forecasts] = await Promise.all([
    supabase
      .from("place_reports")
      .select("user_id, tags, note, photo_path, created_at")
      .gte("created_at", new Date(nowMs - 60 * 86_400_000).toISOString())
      .gte("lat", input.lat - pad).lte("lat", input.lat + pad)
      .gte("lng", input.lng - pad).lte("lng", input.lng + pad)
      .order("created_at", { ascending: false })
      .limit(200),
    // The same forecast as the weather panel (one area, true timing, never over 60 minutes old).
    weatherProvider().areaForecasts([areaOf(input)], nowMs - 3_600_000, nowMs + 2 * 3_600_000).catch(() => ({} as Record<string, null>)),
  ]);

  const area = forecasts[areaOf(input).key] ?? null;
  const now = momentAt(area, input, nowMs, nowMs, forecastHorizonMs(nowMs));
  const pulse = buildPulse({
    hours: input.hours,
    hoursCheckedAt: input.hours_checked_at,
    weather: now.status === "ok" ? now : null,
    // Photos only when asked for (trip stops). Radar places don't get nearby travelers' photos as if they were their own.
    reports: ((rows ?? []) as PulseReport[]).map((r) => (input.include_photos ? r : { ...r, photo_path: null })),
    photoUrl: (path) => supabase.storage.from(REPORT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl,
    nowMs,
    utcOffsetMin: INDIA_UTC_OFFSET_MIN, // India time, whatever the phone's own time zone
  });
  return NextResponse.json({ pulse, generatedAt: new Date(nowMs).toISOString() }); // never includes who reported
}
