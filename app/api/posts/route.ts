import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { verifyUploadedMedia } from "@/lib/server/verify-media";
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

  // The server measures what was really uploaded. A client can claim any length or type; the bytes cannot lie.
  const refusal = await verifyUploadedMedia(storage, input.media);
  if (refusal) {
    await storage.remove(paths);                                  // a refused upload must not linger in storage
    return jsonError(refusal.message, refusal.status);
  }

  // The SERVER decides which destination this belongs to (same name within 40 km = same destination); the client only names it.
  const { data: destinationId, error: destError } = await supabase.rpc("resolve_destination", { _name: input.destination_name ?? input.place_name, _lat: input.lat, _lng: input.lng });
  if (destError || !destinationId) {
    if (destError?.code === "22023") return jsonError("Name the destination (at least 2 letters)", 400);
    return dbError(destError ?? { message: "no destination" }, "post: destination");
  }

  // The id is chosen HERE and the row is not asked back from the insert: "insert … returning" re-checks the new row against the
  // read policy, which looks the post up in a way that cannot yet see a row created by the same statement — so it was refused.
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("posts")
    .insert({
      id,
      author_id: user.id, // from the session, never the body
      destination_id: destinationId,
      kind: input.kind, caption: input.caption, place_name: input.place_name, lat: input.lat, lng: input.lng,
      location_precision: input.location_precision, captured_at: input.captured_at ?? undefined,
      visibility: input.visibility, comments_allowed: input.comments_allowed,
      crowd: input.crowd, conditions: input.conditions, vibes: input.vibes, tip: input.tip,
    });
  if (error) return dbError(error, "post: insert");

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
  // "Posted from the area": earned only if the phone's position is near the destination, right now. Best effort — it never blocks a post.
  let fromArea = false;
  if (input.device_lat !== null && input.device_lng !== null) {
    const { data: ok } = await supabase.rpc("verify_post_area", { _post: id, _lat: input.device_lat, _lng: input.device_lng });
    fromArea = ok === true;
  }
  return NextResponse.json({ ok: true, id, fromArea }, { status: 201 });
}
