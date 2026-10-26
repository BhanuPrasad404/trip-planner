import { createClient } from "@/lib/supabase/server";
import { rateLimiter } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { createTripSchema } from "@/lib/validation/schemas";

/** Which newer column the database doesn't have yet (migration not applied): PostgREST says PGRST204, Postgres says 42703. */
const missingColumn = (e: { code?: string; message?: string } | null): "end_mode" | "intake" | "start_time" | null => {
  if (!e || (e.code !== "PGRST204" && e.code !== "42703")) return null;
  return /end_mode/.test(e.message ?? "") ? "end_mode" : /intake/.test(e.message ?? "") ? "intake" : /start_time/.test(e.message ?? "") ? "start_time" : null;
};

// Create a trip. The owner is added as the first member by the `on_trip_created`
// database trigger, so the two writes are atomic.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`trip-create:${user.id}`, 30, 3600000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  const { data: input, error: bodyError } = await parseBody(req, createTripSchema);
  if (bodyError) return bodyError;

  const insert = (row: Record<string, unknown>) => supabase.from("trips").insert({ ...row, owner_id: user.id }).select().single();
  let row: Record<string, unknown> = { ...input };
  let { data: trip, error } = await insert(row);
  // Until migrations 20261024000000 / 20261025000000 are applied the trip is still created, without the newer fields, and behaves like an
  // old trip: "return to start" is NOT remembered (it acts as open) and the guided-flow answers are not saved. The migrations fix that.
  for (let i = 0; i < 3; i++) {
    const col = missingColumn(error);
    if (!col || !(col in row)) break;
    const { [col]: _dropped, ...rest } = row;
    void _dropped;
    row = rest;
    ({ data: trip, error } = await insert(row));
  }

  if (error) return dbError(error, "create trip");
  return NextResponse.json(trip, { status: 201 });
}
