import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { savedPlaceDeleteSchema, savedPlaceSchema } from "@/lib/validation/schemas";

const MAX_SAVED = 500;
const noStore = { headers: { "Cache-Control": "private, no-store" } };

// Places a traveller saved from Explore: private to them (row level security), no trip needed.
async function who() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await who();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`saved-places:${user.id}`, 120, 60_000)) return jsonError("Slow down a little", 429);
  const { data, error } = await supabase.from("saved_places").select("place_key, name, lat, lng, category, region, created_at").order("created_at", { ascending: false }).limit(MAX_SAVED);
  if (error) return dbError(error, "saved-places: list");
  return NextResponse.json({ places: data ?? [] }, noStore);
}

export async function POST(req: Request) {
  const { supabase, user } = await who();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`saved-places:${user.id}`, 120, 60_000)) return jsonError("Slow down a little", 429);
  const { data: input, error: bodyError } = await parseBody(req, savedPlaceSchema);
  if (bodyError) return bodyError;
  // Saving the same place twice is fine (idempotent); the database enforces the per-person limit.
  const { error } = await supabase.from("saved_places").upsert(
    { user_id: user.id, place_key: input.key, name: input.name, lat: input.lat, lng: input.lng, category: input.category ?? null, region: input.region ?? null },
    { onConflict: "user_id,place_key", ignoreDuplicates: true },
  );
  if (error) {
    if (error.code === "54000" || /saved places/i.test(error.message ?? "")) return jsonError(`You can save up to ${MAX_SAVED} places. Remove one to save another.`, 409);
    return dbError(error, "saved-places: save");
  }
  return NextResponse.json({ ok: true }, noStore);
}

export async function DELETE(req: Request) {
  const { supabase, user } = await who();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`saved-places:${user.id}`, 120, 60_000)) return jsonError("Slow down a little", 429);
  const { data: input, error: bodyError } = await parseBody(req, savedPlaceDeleteSchema);
  if (bodyError) return bodyError;
  const { error } = await supabase.from("saved_places").delete().eq("user_id", user.id).eq("place_key", input.key);
  if (error) return dbError(error, "saved-places: remove");
  return NextResponse.json({ ok: true }, noStore);
}
