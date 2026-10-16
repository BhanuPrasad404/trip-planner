import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring";
import { groupByBucket, storageObjectFromUrl } from "@/lib/trip/deletion";

type Fail = { ok: false; status: number; error: string };
export type RemoveMemberResult = { ok: true; kind: "left" | "removed"; tripName: string } | Fail;

export const OWNER_MUST_HAND_OVER = "You own this trip. Hand it over to another member, or delete the trip, before you leave.";

/**
 * Leave a trip (userId = me) or remove someone from it (owner only).
 *
 * The database decides who may delete which membership (policy "Members leave, owner removes others") and cleans up after it:
 * the person's live location, pings, votes and media rows in THIS trip are deleted, and the stops they added stay with the group
 * without their name (trigger trip_member_left). The checks here only give clear messages. Stored media files of that person in
 * this trip are removed first (service role), so nothing private is left behind — and if that fails, nothing changes.
 */
export async function removeMember(o: {
  supabase: SupabaseClient; admin: SupabaseClient | null; supabaseUrl: string; actorId: string; tripId: string; userId: string;
}): Promise<RemoveMemberResult> {
  const { supabase, actorId, tripId, userId } = o;
  const { data: trip, error: tripError } = await supabase.from("trips").select("id, owner_id, name").eq("id", tripId).maybeSingle();
  if (tripError) return failure(tripError, "find trip");
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  const isOwner = trip.owner_id === actorId;
  const leaving = userId === actorId;
  if (leaving && isOwner) return { ok: false, status: 409, error: OWNER_MUST_HAND_OVER };
  if (!leaving && !isOwner) return { ok: false, status: 403, error: "Only the trip owner can remove members." };

  const files = await mediaFiles(o);
  if (!files.ok) return files;

  const { data, error } = await supabase.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", userId).select("user_id");
  if (error) return failure(error, "delete membership");
  if (!data || data.length === 0) return { ok: false, status: 404, error: leaving ? "You're not on this trip." : "That person isn't on this trip any more." };
  return { ok: true, kind: leaving ? "left" : "removed", tripName: trip.name as string };
}

async function mediaFiles(o: { supabase: SupabaseClient; admin: SupabaseClient | null; supabaseUrl: string; tripId: string; userId: string }): Promise<{ ok: true } | Fail> {
  const { data, error } = await o.supabase.from("trip_media").select("file_url").eq("trip_id", o.tripId).eq("uploaded_by", o.userId).limit(10_000);
  if (error) return failure(error, "list media");
  const objects = ((data ?? []) as { file_url: string | null }[])
    .map((m) => (m.file_url ? storageObjectFromUrl(m.file_url, o.supabaseUrl) : null))
    .filter((x): x is { bucket: string; path: string } => x !== null);
  if (objects.length === 0) return { ok: true };
  if (!o.admin) return { ok: false, status: 503, error: "Their trip photos can't be removed right now, so nothing was changed. Please try again later." };
  for (const g of groupByBucket(objects)) {
    for (let i = 0; i < g.paths.length; i += 100) {
      const { error: rm } = await o.admin.storage.from(g.bucket).remove(g.paths.slice(i, i + 100));
      if (rm) {
        reportError(new Error(`member remove: storage remove failed: ${rm.message}`), { where: "api", extra: { bucket: g.bucket } });
        return { ok: false, status: 502, error: "We couldn't remove their trip photos, so nothing was changed. Please try again." };
      }
    }
  }
  return { ok: true };
}

export type TransferResult = { ok: true } | Fail;

/** The owner hands the trip to another member (database function transfer_trip_ownership checks every rule). */
export async function transferOwnership(o: { supabase: SupabaseClient; tripId: string; newOwnerId: string }): Promise<TransferResult> {
  const { error } = await o.supabase.rpc("transfer_trip_ownership", { p_trip: o.tripId, p_new_owner: o.newOwnerId });
  if (!error) return { ok: true };
  if (error.code === "42501") return { ok: false, status: 403, error: "Only the trip owner can hand it over." };
  if (error.code === "P0002") return { ok: false, status: 400, error: "Choose someone who is already on this trip." };
  if (error.code === "22023") return { ok: false, status: 400, error: "Choose another member." };
  if (error.code === "PGRST202" || error.code === "42883") {
    console.error("[api] transfer: function missing (migration 20261022000000 not applied)");
    return { ok: false, status: 503, error: "This needs a database update that hasn't been applied yet. Nothing was changed." };
  }
  return failure(error, "transfer");
}

function failure(error: { code?: string; message?: string }, step: string): Fail {
  console.error(`[api] trip members: ${step}:`, error.code, error.message);
  if (error.code === "42501") return { ok: false, status: 403, error: "You don't have permission to do that." };
  reportError(new Error(`trip members: ${step}: ${error.code ?? "?"} ${error.message ?? ""}`), { where: "api" });
  return { ok: false, status: 500, error: "Something went wrong. Please try again." };
}
