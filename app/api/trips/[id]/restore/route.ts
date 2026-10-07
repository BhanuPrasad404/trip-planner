import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { restoreSchema, uuid } from "@/lib/validation/schemas";

// UNDO for Autopilot: put stops back exactly as they were (day, order, times, status) and remove stops the action added.
// Only stops of THIS trip are touched; ids from anywhere else are ignored.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, restoreSchema);
  if (bodyError) return bodyError;

  const { data: current, error: listError } = await supabase.from("places").select("id, name, lat, lng").eq("trip_id", id);
  if (listError) return dbError(listError, "restore: list");
  const mine = new Map((current ?? []).map((p) => [p.id as string, p]));

  const rows = input.places
    .filter((p) => mine.has(p.id))
    .map((p) => {
      const c = mine.get(p.id)!;
      return {
        id: p.id, trip_id: id, name: c.name, lat: c.lat, lng: c.lng,
        day_number: p.day_number, sequence_order: p.sequence_order, arrival_time: p.arrival_time,
        drive_minutes: p.drive_minutes, drive_km: p.drive_km, status: p.status,
        status_at: p.status === "planned" ? null : new Date().toISOString(),
      };
    });
  if (rows.length > 0) {
    const { error } = await supabase.from("places").upsert(rows, { onConflict: "id" });
    if (error) return dbError(error, "restore: upsert");
  }

  const removable = input.delete_ids.filter((d) => mine.has(d));
  if (removable.length > 0) {
    const { error } = await supabase.from("places").delete().in("id", removable).eq("trip_id", id);
    if (error) return dbError(error, "restore: delete");
  }
  return NextResponse.json({ ok: true, restored: rows.length, removed: removable.length });
}
