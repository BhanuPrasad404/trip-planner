import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { loadBuilder } from "@/lib/server/builder";
import { runEngine } from "@/lib/server/trip-engine";
import { buildTrip } from "@/lib/trip-builder";
import { adviseDuration } from "@/lib/trip-builder/duration";
import { todayISO } from "@/lib/server/trip-data";
import { builderSchema, uuid } from "@/lib/validation/schemas";

export const maxDuration = 30;

// Smart Trip Builder preview: reality check, clusters and complete plan options for THIS trip's places. Nothing is saved.
// With `engine: true` the three options are the Phase 3 engine's (Relaxed / Balanced / Most places, with drive days to a far-away
// area, night halts, no driving after dark, quick "what if I had N days?"); if the engine fails, the builder's own options are sent.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error: bodyError } = await parseBody(req, builderSchema);
  if (bodyError) return bodyError;
  if (!(await consumeQuota(supabase, "builder", 80))) return jsonError("You've used the trip builder a lot today. Please try again tomorrow.", 429);

  const today = await todayISO();
  const r = await loadBuilder(supabase, id, { endMode: input.end_mode, styles: input.engine ? [] : input.styles, todayISO: today, userId: user.id, skip: input.skip });
  if (!r.ok) return jsonError(r.error, r.status);
  if (input.engine) {
    try {
      const run = await runEngine(r.input, { intake: r.trip.intake ?? null, todayISO: today, nightDriving: input.night_driving, maxDriveHours: input.max_drive_hours });
      // "What if I had N days?" comes with each plan (fast), so the slow duration advice is not needed here.
      return NextResponse.json({ result: { ...r.result, options: run.plan.variants.map((v) => v.option) }, signature: r.signature, unscheduledIds: r.unscheduledIds, engine: run.view });
    } catch (e) {
      console.error("engine: plan failed, sending the builder's options", e);
      const result = buildTrip(r.input);
      return NextResponse.json({ result, signature: r.signature, unscheduledIds: r.unscheduledIds, duration: adviseDuration(r.input), engine: null });
    }
  }
  // How many days these places really need (from actually planning them), so the traveller does not have to work it out. Advice only.
  return NextResponse.json({ result: r.result, signature: r.signature, unscheduledIds: r.unscheduledIds, duration: adviseDuration(r.input) });
}
