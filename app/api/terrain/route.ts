import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import { elevationProvider } from "@/lib/providers/registry";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { analyzeProfile, profileStats, sampleAlong, toProfile } from "@/lib/travel/terrain";

export const maxDuration = 20;

const bodySchema = z.object({
  line: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2).max(1500),
});

/**
 * What the ground does along a route: the height profile and the sustained climbs and descents on it. Facts from elevation only;
 * we have no road-condition or mobile-coverage data and say nothing about either. The traveller asks for it; nothing runs by itself.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`terrain:${user.id}`, 20, 60_000)) return jsonError("Too many terrain checks. Please wait a minute.", 429);
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;

  const provider = elevationProvider();
  const samples = sampleAlong(data.line, provider.maxPoints);
  if (samples.length < 3) return jsonError("That route is too short to say anything about its terrain.", 422);
  let elevations: (number | null)[];
  try {
    elevations = await provider.elevations(samples.map((s) => ({ lat: s.lat, lng: s.lng })));
  } catch (e) {
    reportError(e, { where: "terrain", extra: { provider: provider.id } });
    return jsonError("The elevation service isn't available right now, so we can't say what the terrain is like. Please try again later.", 502);
  }
  const profile = toProfile(samples.map((s, i) => ({ km: s.km, elevM: elevations[i] })));
  if (profile.length < 3) return jsonError("We couldn't get elevation data for this route.", 502);
  const step = Math.max(1, Math.ceil(profile.length / 60));
  return NextResponse.json(
    {
      source: { provider: provider.id, label: "Open-Meteo elevation (global 90 m terrain model)", approximate: true },
      retrievedAt: Date.now(),
      totalKm: Math.round(samples[samples.length - 1].km * 10) / 10,
      segments: analyzeProfile(profile),
      stats: profileStats(profile),
      profile: profile.filter((_, i) => i % step === 0 || i === profile.length - 1).map((p) => ({ km: Math.round(p.km * 10) / 10, elevM: Math.round(p.elevM) })),
    },
    { headers: { "cache-control": "private, max-age=3600" } }
  );
}
