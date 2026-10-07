import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { loadBuilder } from "@/lib/server/builder";
import { todayISO } from "@/lib/server/trip-data";
import { builderSchema, uuid } from "@/lib/validation/schemas";

export const maxDuration = 30;

// Smart Trip Builder preview: reality check, clusters and complete plan options for THIS trip's places. Nothing is saved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error: bodyError } = await parseBody(req, builderSchema);
  if (bodyError) return bodyError;
  if (!(await consumeQuota(supabase, "builder", 80))) return jsonError("You've used the trip builder a lot today. Please try again tomorrow.", 429);

  const r = await loadBuilder(supabase, id, { endMode: input.end_mode, styles: input.styles, todayISO: await todayISO(), userId: user.id });
  if (!r.ok) return jsonError(r.error, r.status);
  return NextResponse.json({ result: r.result, signature: r.signature, unscheduledIds: r.unscheduledIds });
}
