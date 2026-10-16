import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { getSupabaseEnv } from "@/lib/env";
import { removeMember } from "@/lib/server/trip-members";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/schemas";

/**
 * Leave a trip (your own user id) or remove a member (owner only). The owner cannot leave: they hand the trip over or delete it.
 * Their live location, votes and pings in this trip are deleted; the stops they added stay with the group without their name.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(userId).success) return jsonError("Invalid id", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const result = await removeMember({
    supabase, admin: hasAdminAccess() ? createAdminClient() : null, supabaseUrl: getSupabaseEnv().url, actorId: user.id, tripId: id, userId,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true, kind: result.kind, trip_name: result.tripName });
}
