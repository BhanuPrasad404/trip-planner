import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { followSchema } from "@/lib/social/schemas";

async function resolve(username: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: jsonError("Please sign in", 401) } as const;
  const { data: me } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!me) return { ok: false, res: jsonError("Set up your traveler profile first", 409) } as const;
  const { data: target } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
  if (!target) return { ok: false, res: jsonError("Traveler not found", 404) } as const;
  return { ok: true, supabase, me: user.id, target: (target as { id: string }).id } as const;
}

// Follow someone. Their privacy setting decides the outcome ("accepted" or "pending" approval) — the database sets it.
export async function POST(req: Request) {
  const { data: input, error: bodyError } = await parseBody(req, followSchema);
  if (bodyError) return bodyError;
  const r = await resolve(input.username);
  if (!r.ok) return r.res;
  if (r.me === r.target) return jsonError("You can't follow yourself", 400);
  if (!(await consumeQuota(r.supabase, "follow", 200))) return jsonError("Too many follows today — please try again tomorrow.", 429);

  const { data, error } = await r.supabase.from("follows").insert({ follower_id: r.me, followee_id: r.target }).select("status").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ ok: true, status: "already" });
    return dbError(error, "follow: insert");
  }
  return NextResponse.json({ ok: true, status: (data as { status: string }).status }, { status: 201 });
}

export async function DELETE(req: Request) {
  const username = new URL(req.url).searchParams.get("username") ?? "";
  const parsed = followSchema.safeParse({ username });
  if (!parsed.success) return jsonError("Invalid username", 400);
  const r = await resolve(parsed.data.username);
  if (!r.ok) return r.res;
  const { error } = await r.supabase.from("follows").delete().eq("follower_id", r.me).eq("followee_id", r.target);
  if (error) return dbError(error, "follow: delete");
  return NextResponse.json({ ok: true });
}
