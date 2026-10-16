import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring";

export const INVITE_EXPIRY_HOURS = [24, 168, 720] as const; // 1 day, 7 days, 30 days (null = never)
export type JoinStatus = "joined" | "already_member" | "invalid" | "expired" | "too_many_attempts" | "error";

type Fail = { ok: false; status: number; error: string };
const missing = (code?: string) => code === "PGRST202" || code === "42883";

/** The owner makes a new invite link. The old one stops working at once (database function rotate_trip_invite). */
export async function rotateInvite(supabase: SupabaseClient, tripId: string, expiresInHours: number | null): Promise<{ ok: true; code: string; expiresAt: string | null } | Fail> {
  const { data, error } = await supabase.rpc("rotate_trip_invite", { p_trip: tripId, p_expires_in_hours: expiresInHours });
  if (error) {
    if (error.code === "42501") return { ok: false, status: 403, error: "Only the trip owner can make a new invite link." };
    if (error.code === "22023") return { ok: false, status: 400, error: "Choose how long the link should work." };
    if (missing(error.code)) {
      console.error("[api] invite rotate: function missing (migration 20261023000000 not applied)");
      return { ok: false, status: 503, error: "This needs a database update that hasn't been applied yet. Your current link still works." };
    }
    console.error("[api] invite rotate:", error.code, error.message);
    reportError(new Error(`invite rotate: ${error.code ?? "?"} ${error.message ?? ""}`), { where: "api" });
    return { ok: false, status: 500, error: "Something went wrong. Your current link still works." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { invite_code?: string; invite_expires_at?: string | null } | null;
  if (!row?.invite_code) return { ok: false, status: 404, error: "Trip not found" };
  return { ok: true, code: row.invite_code, expiresAt: row.invite_expires_at ?? null };
}

/** Join with an invite code. Until the invite migration is applied, falls back to the old function (no expiry, no throttling). */
export async function joinWithInvite(supabase: SupabaseClient, code: string): Promise<{ status: JoinStatus; tripId: string | null }> {
  if (!/^[a-zA-Z0-9]{6,32}$/.test(code)) return { status: "invalid", tripId: null };
  const { data, error } = await supabase.rpc("join_trip_with_invite", { _code: code });
  if (!error) {
    const r = data as { status?: JoinStatus; trip_id?: string } | null;
    const status = r?.status && ["joined", "already_member", "invalid", "expired", "too_many_attempts"].includes(r.status) ? r.status : "error";
    return { status, tripId: r?.trip_id ?? null };
  }
  if (missing(error.code)) {
    const old = await supabase.rpc("join_trip_by_code", { _code: code });
    if (!old.error && typeof old.data === "string") return { status: "joined", tripId: old.data };
    return { status: "invalid", tripId: null };
  }
  console.error("[join] invite:", error.code, error.message);
  return { status: "error", tripId: null };
}
