import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { isOwnPhotoPath } from "@/lib/reports";
import { createReportSchema } from "@/lib/validation/schemas";

// Share a fresh update (tags, note, optional photo) about a place you are visiting.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, createReportSchema);
  if (bodyError) return bodyError;

  // The photo must live in YOUR folder — otherwise someone could attach a report to another person's file.
  if (input.photo_path && !isOwnPhotoPath(input.photo_path, user.id)) return jsonError("Invalid photo", 400);

  if (!(await consumeQuota(supabase, "report", 30))) {
    return jsonError("That's a lot of updates today — thank you! Please try again tomorrow.", 429);
  }

  const { data, error } = await supabase
    .from("place_reports")
    .insert({
      user_id: user.id, // never taken from the request body
      place_name: input.place_name,
      lat: input.lat,
      lng: input.lng,
      tags: input.tags,
      note: input.note,
      photo_path: input.photo_path,
    })
    .select("id")
    .single();
  if (error) return dbError(error, "report: insert");
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}
