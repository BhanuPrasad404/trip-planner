import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { commentSchema, postIdSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

const PAGE = 20;
const cursorRe = /^(\d{4}-\d{2}-\d{2}T[\d:.+Z-]{8,32})\|([0-9a-f-]{36})$/i;   // strict: it is placed into a filter, so never free text
type Row = { id: string; parent_id: string | null; body: string; created_at: string; author: { username: string; display_name: string | null } | null };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);

  const cursor = new URL(req.url).searchParams.get("cursor");
  let q = supabase.from("post_comments").select("id, parent_id, body, created_at, author:profiles(username, display_name)").eq("post_id", id.data)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(PAGE + 1);
  if (cursor) {
    const m = cursorRe.exec(cursor);
    if (!m) return jsonError("Invalid cursor", 400);
    q = q.or(`created_at.gt.${m[1]},and(created_at.eq.${m[1]},id.gt.${m[2]})`);
  }
  const { data, error } = await q;
  if (error) return dbError(error, "comments: list");
  const list = (data ?? []) as unknown as Row[];
  const page = list.slice(0, PAGE);
  const last = page[page.length - 1];
  return NextResponse.json({
    comments: page.map((c) => ({ id: c.id, parentId: c.parent_id, body: c.body, createdAt: c.created_at, author: { username: c.author?.username ?? "traveler", displayName: c.author?.display_name ?? null } })),
    nextCursor: list.length > PAGE && last ? `${last.created_at}|${last.id}` : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);
  const { data: input, error: bodyError } = await parseBody(req, commentSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`comment:${user.id}`, 20, 60_000)) return jsonError("You're commenting very fast — please wait a moment", 429);

  const { data: me } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!me) return jsonError("Set up your traveler profile first", 409);

  const { data, error } = await supabase.from("post_comments")
    .insert({ post_id: id.data, author_id: user.id, parent_id: input.parent_id ?? null, body: input.body })   // author from the session, never the body
    .select("id, parent_id, body, created_at").single();
  if (error) {
    if (error.code === "42501") return jsonError("Comments aren't available on this post", 403);
    if (error.code === "23514") return jsonError("You can reply to a top-level comment on this post", 400);
    return dbError(error, "comments: insert");
  }
  const c = data as { id: string; parent_id: string | null; body: string; created_at: string };
  return NextResponse.json({ comment: { id: c.id, parentId: c.parent_id, body: c.body, createdAt: c.created_at } }, { status: 201 });
}
