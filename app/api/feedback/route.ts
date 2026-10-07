import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { feedbackSchema } from "@/lib/validation/schemas";

// Lets testers tell us what confused them, right inside the app.
// Read everyone's feedback in the Supabase dashboard: Table Editor → feedback.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, feedbackSchema);
  if (bodyError) return bodyError;

  if (!(await consumeQuota(supabase, "feedback", 20))) {
    return jsonError("That's a lot of feedback today — thank you! Please try again tomorrow.", 429);
  }

  // user_id is always the signed-in user; RLS also checks trip membership.
  const { error } = await supabase.from("feedback").insert({
    user_id: user.id,
    trip_id: input.trip_id,
    page: input.page,
    rating: input.rating,
    message: input.message,
  });
  if (error) return dbError(error, "feedback");
  return NextResponse.json({ ok: true }, { status: 201 });
}
