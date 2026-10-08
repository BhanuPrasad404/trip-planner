import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";

const PAGE = 20;
const cursorRe = /^(\d{4}-\d{2}-\d{2}T[\d:.+Z-]{8,32})\|([0-9a-f-]{36})$/i;
type Row = { id: string; actor_user: string; kind: "like" | "comment" | "reply" | "helpful" | "trip_add"; post_id: string; created_at: string; read_at: string | null; post: { destination: { name: string } | null } | null };

// What happened on my posts. `unread` is a cheap count the bell polls; the list itself loads when the sheet opens.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`notifs:${user.id}`, 90, 60_000)) return jsonError("Slow down a little", 429);

  const url = new URL(req.url);
  if (url.searchParams.get("count") === "1") {
    const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    if (error) return dbError(error, "notifications: count");
    return NextResponse.json({ unread: count ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const cursor = url.searchParams.get("cursor");
  let q = supabase.from("notifications").select("id, actor_user, kind, post_id, created_at, read_at, post:posts(destination:destinations(name))")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE + 1);
  if (cursor) {
    const m = cursorRe.exec(cursor);
    if (!m) return jsonError("Invalid cursor", 400);
    q = q.or(`created_at.lt.${m[1]},and(created_at.eq.${m[1]},id.lt.${m[2]})`);
  }
  const { data, error } = await q;
  if (error) return dbError(error, "notifications: list");
  const list = (data ?? []) as unknown as Row[];
  const page = list.slice(0, PAGE);

  const actorIds = [...new Set(page.map((n) => n.actor_user))];
  const { data: profiles } = actorIds.length ? await supabase.from("profiles").select("id, username").in("id", actorIds) : { data: [] };
  const names = new Map(((profiles ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]));
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);

  const last = page[page.length - 1];
  return NextResponse.json({
    notifications: page.map((n) => ({ id: n.id, kind: n.kind, actor: names.get(n.actor_user) ?? null, postId: n.post_id, destination: n.post?.destination?.name ?? null, read: !!n.read_at, createdAt: n.created_at })),
    unread: count ?? 0,
    nextCursor: list.length > PAGE && last ? `${last.created_at}|${last.id}` : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
