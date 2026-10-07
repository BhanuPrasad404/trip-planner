import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { buildPulse, type PulseReport } from "@/lib/intel/pulse";
import { weatherProvider } from "@/lib/providers/registry";
import { consumeQuota } from "@/lib/quota";
import { REPORT_PHOTO_BUCKET } from "@/lib/reports";
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
  const [{ data: rows }, hourly] = await Promise.all([
    supabase
      .from("place_reports")
      .select("user_id, tags, note, photo_path, created_at")
      .gte("created_at", new Date(nowMs - 60 * 86_400_000).toISOString())
      .gte("lat", input.lat - pad).lte("lat", input.lat + pad)
      .gte("lng", input.lng - pad).lte("lng", input.lng + pad)
      .order("created_at", { ascending: false })
      .limit(200),
    weatherProvider().hourly({ lat: input.lat, lng: input.lng }, 3).catch(() => []),
  ]);

  const hour = hourly.find((h) => Date.parse(h.time) <= nowMs && nowMs < Date.parse(h.time) + 3_600_000) ?? null;
  const pulse = buildPulse({
    hours: input.hours,
    hoursCheckedAt: input.hours_checked_at,
    weather: hour,
    reports: (rows ?? []) as PulseReport[],
    photoUrl: (path) => supabase.storage.from(REPORT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl,
    nowMs,
    utcOffsetMin: input.utc_offset_min,
  });
  return NextResponse.json({ pulse, generatedAt: new Date(nowMs).toISOString() }); // never includes who reported
}
