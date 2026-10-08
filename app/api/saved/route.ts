import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { rowToCandidate, toItem, type FeedRow } from "@/lib/feed/map";
import { loadMedia } from "@/lib/server/feed-service";
import { supabaseMediaStorage } from "@/lib/social/storage";

const PAGE = 12;

// My saved posts and videos, newest save first. Posts that have since been deleted, hidden or made private simply drop out.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`saved:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);

  const cursor = new URL(req.url).searchParams.get("cursor");
  if (cursor && Number.isNaN(Date.parse(cursor))) return jsonError("Invalid cursor", 400);
  let q = supabase.from("post_saves").select("post_id, created_at").order("created_at", { ascending: false }).limit(PAGE + 1);   // RLS: only my rows
  if (cursor) q = q.lt("created_at", cursor);
  const { data: saves, error } = await q;
  if (error) return dbError(error, "saved: list");
  const list = (saves ?? []) as { post_id: string; created_at: string }[];
  const page = list.slice(0, PAGE);

  const { data: rows, error: rowsError } = page.length ? await supabase.rpc("feed_items", { _ids: page.map((s) => s.post_id) }) : { data: [], error: null };
  if (rowsError) return dbError(rowsError, "saved: items");
  const byId = new Map(((rows ?? []) as FeedRow[]).map((r) => [r.id, rowToCandidate(r)]));
  const candidates = page.map((s) => ({ s, c: byId.get(s.post_id) })).filter((x): x is { s: { post_id: string; created_at: string }; c: NonNullable<ReturnType<typeof rowToCandidate>> } => !!x.c);
  const media = await loadMedia(supabase, supabaseMediaStorage(supabase), candidates.map((x) => x.c.id));
  const now = new Date();
  return NextResponse.json({
    items: candidates.map((x) => ({ ...toItem(x.c, media.get(x.c.id) ?? [], { now, viewerId: user.id, position: null }), savedAt: x.s.created_at })),
    nextCursor: list.length > PAGE ? page[page.length - 1].created_at : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
