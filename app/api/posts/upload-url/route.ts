import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { newMediaPath } from "@/lib/social/media";
import { uploadUrlSchema } from "@/lib/social/schemas";
import { supabaseMediaStorage } from "@/lib/social/storage";

// Step 1 of posting media: ask permission. The browser then uploads the file DIRECTLY to Storage with the token
// (so a 30 MB video never passes through this server), and step 2 (POST /api/posts) attaches it to a post.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: me } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!me) return jsonError("Set up your traveler profile first", 409);

  const { data: input, error: bodyError } = await parseBody(req, uploadUrlSchema);
  if (bodyError) return bodyError;

  if (!(await consumeQuota(supabase, "post_upload", 60))) return jsonError("That's a lot of uploads today — please try again tomorrow.", 429);

  const target = await supabaseMediaStorage(supabase).createUploadTarget(newMediaPath(user.id, input.mime));
  if (!target) return jsonError("Uploads are not available right now. Please try again.", 503);
  return NextResponse.json({ path: target.path, token: target.token });
}
