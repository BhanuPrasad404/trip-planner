import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { likeEscape } from "@/lib/feed/compose";
import { rateLimiter } from "@/lib/rate-limit";

// Instant destination suggestions from places travelers have ALREADY shared about. No map lookup, no daily quota — so the
// share screen can answer as you type. With no query it returns the busiest destinations.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`suggest:${user.id}`, 90, 60_000)) return jsonError("Slow down a little", 429);

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length === 1) return NextResponse.json({ destinations: [] });

  let query = supabase.from("destinations").select("id, name, lat, lng, post_count").order("post_count", { ascending: false }).order("name", { ascending: true }).limit(6);
  if (q) query = query.ilike("name", `%${likeEscape(q)}%`);
  const { data, error } = await query;
  if (error) return dbError(error, "destinations: suggest");
  return NextResponse.json({
    destinations: (data ?? []).map((d) => ({ name: d.name as string, address: "Shared by Trailmate travelers", lat: d.lat as number, lng: d.lng as number, source: "trailmate", posts: d.post_count as number })),
  }, { headers: { "Cache-Control": "private, max-age=30" } });
}
