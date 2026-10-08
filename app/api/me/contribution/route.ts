import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";

// "Your contribution": counted from OTHER travelers' actions only (saves, helpful, trip adds), never from self-reported numbers.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`contrib:${user.id}`, 30, 60_000)) return jsonError("Slow down a little", 429);
  const { data, error } = await supabase.rpc("my_contribution");
  if (error) return dbError(error, "contribution");
  const r = (Array.isArray(data) ? data[0] : data) as { posts: number; destinations: number; travelers_helped: number; saves: number; helpful: number; trip_adds: number; likes: number } | undefined;
  return NextResponse.json({ posts: r?.posts ?? 0, destinations: r?.destinations ?? 0, travelersHelped: r?.travelers_helped ?? 0, saves: r?.saves ?? 0, helpful: r?.helpful ?? 0, tripAdds: r?.trip_adds ?? 0, likes: r?.likes ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
}
