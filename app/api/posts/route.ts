import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { isOwnMediaPath } from "@/lib/social/media";
import { createPostSchema } from "@/lib/social/schemas";
import { supabaseMediaStorage } from "@/lib/social/storage";

// Step 2: publish a post (photo, short video, or a written report) about a place.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, createPostSchema);
  if (bodyError) return bodyError;

  const { data: me } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!me) return jsonError("Set up your traveler profile first", 409);

  // Every file must be in YOUR folder, and must really exist in Storage.
  const paths = input.media.flatMap((m) => [m.storage_path, ...(m.poster_path ? [m.poster_path] : [])]);
  if (paths.some((p) => !isOwnMediaPath(p, user.id))) return jsonError("Invalid media", 400);
  const storage = supabaseMediaStorage(supabase);
  if (paths.length > 0 && !(await storage.allExist(paths))) return jsonError("A file didn't finish uploading — please try again", 400);

  if (!(await consumeQuota(supabase, "post", 20))) return jsonError("That's a lot of posts today — thank you! Please try again tomorrow.", 429);

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      author_id: user.id, // from the session, never the body
      kind: input.kind, caption: input.caption, place_name: input.place_name, lat: input.lat, lng: input.lng,
      location_precision: input.location_precision, captured_at: input.captured_at ?? undefined,
      visibility: input.visibility, comments_allowed: input.comments_allowed,
    })
    .select("id")
    .single();
  if (error || !post) return dbError(error ?? { message: "no row" }, "post: insert");
  const id = (post as { id: string }).id;

  if (input.media.length > 0) {
    const { error: mediaError } = await supabase.from("post_media").insert(
      input.media.map((m, i) => ({ post_id: id, position: i, media_type: m.media_type, storage_path: m.storage_path, poster_path: m.poster_path, mime: m.mime, bytes: m.bytes, width: m.width, height: m.height, duration_s: m.duration_s }))
    );
    if (mediaError) {
      await supabase.from("posts").delete().eq("id", id); // no half-posts
      await storage.remove(paths);
      return dbError(mediaError, "post: media");
    }
  }
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
