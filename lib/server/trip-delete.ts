import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring";
import { groupByBucket, storageObjectFromUrl, tripNameMatches } from "@/lib/trip/deletion";

export type DeleteTripResult = { ok: true; filesRemoved: number } | { ok: false; status: number; error: string };

/**
 * Permanently delete a trip (owner only).
 *
 * The database removes the trip's stops, votes, members, live locations, location pings and media rows with it (ON DELETE CASCADE),
 * and Row Level Security allows the delete only for the owner, so the owner check here is for a clear message, not the protection.
 * Files: `trip_media.file_url` may point at files in Supabase Storage. Those are removed FIRST with the service-role key (another
 * member's upload can't be removed with the owner's own rights). If they can't be removed, nothing is deleted, so no private
 * photo is ever left behind without its trip. Community updates and feed posts are not part of the trip and are kept.
 */
export async function deleteTrip(opts: {
  supabase: SupabaseClient;
  admin: SupabaseClient | null;
  supabaseUrl: string;
  userId: string;
  tripId: string;
  confirmName: string;
}): Promise<DeleteTripResult> {
  const { supabase, admin, supabaseUrl, userId, tripId, confirmName } = opts;

  const { data: trip, error: findError } = await supabase.from("trips").select("id, owner_id, name").eq("id", tripId).maybeSingle();
  if (findError) return failure(findError, "find");
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.owner_id !== userId) return { ok: false, status: 403, error: "Only the trip owner can delete this trip." };
  if (!tripNameMatches(confirmName, trip.name as string)) return { ok: false, status: 400, error: "Type the trip name exactly to confirm." };

  const { data: media, error: mediaError } = await supabase.from("trip_media").select("file_url").eq("trip_id", tripId).limit(10_000);
  if (mediaError) return failure(mediaError, "list media");
  const objects = ((media ?? []) as { file_url: string | null }[])
    .map((m) => (m.file_url ? storageObjectFromUrl(m.file_url, supabaseUrl) : null))
    .filter((o): o is { bucket: string; path: string } => o !== null);

  let filesRemoved = 0;
  if (objects.length > 0) {
    if (!admin) {
      console.error(`[api] trip delete: ${objects.length} stored files need SUPABASE_SERVICE_ROLE_KEY to be removed`);
      return { ok: false, status: 503, error: "This trip's photos can't be removed right now, so nothing was deleted. Please try again later." };
    }
    for (const g of groupByBucket(objects)) {
      for (let i = 0; i < g.paths.length; i += 100) {
        const { error } = await admin.storage.from(g.bucket).remove(g.paths.slice(i, i + 100));
        if (error) {
          reportError(new Error(`trip delete: storage remove failed: ${error.message}`), { where: "api", extra: { bucket: g.bucket } });
          return { ok: false, status: 502, error: "We couldn't remove this trip's photos, so nothing was deleted. Please try again." };
        }
        filesRemoved += Math.min(100, g.paths.length - i);
      }
    }
  }

  const { data: deleted, error: deleteError } = await supabase.from("trips").delete().eq("id", tripId).select("id");
  if (deleteError) return failure(deleteError, "delete");
  if (!deleted || deleted.length === 0) return { ok: false, status: 404, error: "Trip not found" };
  return { ok: true, filesRemoved };
}

function failure(error: { code?: string; message?: string }, step: string): DeleteTripResult {
  console.error(`[api] trip delete: ${step}:`, error.code, error.message);
  if (error.code === "42501") return { ok: false, status: 403, error: "Only the trip owner can delete this trip." };
  reportError(new Error(`trip delete: ${step}: ${error.code ?? "?"} ${error.message ?? ""}`), { where: "api" });
  return { ok: false, status: 500, error: "Something went wrong. Please try again." };
}
