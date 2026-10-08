import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { postIdSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";
import { summarizeReality, type PulseRaw } from "@/lib/feed/reality";

// "What is it like right now?" for one destination, from what travelers recently posted. The database returns timestamped facts;
// summarizeReality() decides how much to claim from how few (one report is never called "usually").
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Destination not found", 404);
  if (!rateLimiter.take(`pulse:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);

  const [{ data: dest }, { data: raw, error }] = await Promise.all([
    supabase.from("destinations").select("id, name, lat, lng").eq("id", id.data).maybeSingle(),
    supabase.rpc("destination_pulse", { _dest: id.data }),
  ]);
  if (error) return dbError(error, "destination pulse");
  if (!dest) return jsonError("Destination not found", 404);
  const d = dest as { id: string; name: string; lat: number; lng: number };
  return NextResponse.json({ destination: { id: d.id, name: d.name, lat: d.lat, lng: d.lng }, reality: summarizeReality((raw ?? {}) as PulseRaw, Date.now()), asOf: new Date().toISOString() }, { headers: { "Cache-Control": "private, max-age=30" } });
}
