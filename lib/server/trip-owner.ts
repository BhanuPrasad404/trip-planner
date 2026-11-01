// SERVER ONLY. Who may change the SHARED itinerary. Any member may suggest a change; only the trip's owner may approve, decline or undo one.
// Enforced here (the API) and, for the rows that record a decision, again by the database policy (migration 20261102000000), so a
// request that skips the app is refused as well. A person's own journey (when they left, paused, arrived) is theirs and is not governed by this.
import type { SupabaseClient } from "@supabase/supabase-js";

export const OWNER_ONLY_MESSAGE = "Only the trip owner can approve, decline or undo changes to the shared plan. Your suggestion is saved for them.";

export type OwnerCheck = { ok: true } | { ok: false; status: number; error: string };

/** Is `userId` the owner of the trip? 404 when the trip is not visible to them (Row Level Security), 403 when they are a member but not the owner. */
export async function requireOwner(supabase: SupabaseClient, tripId: string, userId: string): Promise<OwnerCheck> {
  const { data, error } = await supabase.from("trips").select("id, owner_id").eq("id", tripId).maybeSingle();
  if (error) return { ok: false, status: 500, error: "Couldn't check who owns this trip. Nothing was changed." };
  if (!data) return { ok: false, status: 404, error: "Trip not found" };
  return (data as { owner_id: string | null }).owner_id === userId ? { ok: true } : { ok: false, status: 403, error: OWNER_ONLY_MESSAGE };
}
