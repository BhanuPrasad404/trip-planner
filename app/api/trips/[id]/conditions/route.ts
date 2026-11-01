import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { loadReplanInput } from "@/lib/server/replan-proposals";
import { assessCurrentPlan } from "@/lib/trip/replan-proposal";
import { conditionsSchema, uuid } from "@/lib/validation/schemas";

export const maxDuration = 30;

/**
 * "How does my plan, as it stands, meet the real world?": forecast hazards at the visit times, hours (confirmed or only from map data),
 * daylight and hill roads, fuel range. It changes nothing and stores nothing (the position, if sent, is used for this one answer). Every
 * finding says what it rests on and when it was fetched; whatever could not be checked is listed as that, and the things nobody can know
 * from here (traffic, road closures, fuel stations) are stated.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, conditionsSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  if (!rateLimiter.take(`trip-conditions:${user.id}`, 30, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  const loaded = await loadReplanInput(supabase, id, user.id, parsed.data, { needRevisions: false });
  if (!loaded.ok) return jsonError(loaded.error, loaded.status);
  const a = assessCurrentPlan(loaded.input);
  return NextResponse.json({ ok: true, asOf: Date.now(), hasDates: !!loaded.input.startDate, ...a }, { headers: { "Cache-Control": "private, no-store" } });
}
