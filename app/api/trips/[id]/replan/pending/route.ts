import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { EVENT_COLUMNS, currentRevision, failedClaims, loadRevisions, rowToEvent, type EventRow } from "@/lib/server/journey-events";
import { uuid } from "@/lib/validation/schemas";

/** A suggestion nobody has answered for this long is not offered any more (the plan has moved on; ask again). */
const PENDING_MAX_AGE_MS = 7 * 24 * 3_600_000;
type Meta = Record<string, unknown> & { base_rev?: number | null; feasible?: boolean; of?: number };

/**
 * The changes members have SUGGESTED to the trip owner and nobody has answered yet. Any member sees them (so everyone knows what is on the
 * table); only the owner can approve or decline (the decide route refuses anyone else). A suggestion appears here only because a member
 * tapped "Suggest this to the owner": asking for options alone shows the owner nothing. Only suggestions made against the plan that is
 * current right now are listed; one that has gone out of date is not offered.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const tripR = await supabase.from("trips").select("id, owner_id").eq("id", id).maybeSingle();
  if (tripR.error) return dbError(tripR.error, "pending: trip");
  if (!tripR.data) return jsonError("Trip not found", 404);
  const isOwner = (tripR.data as { owner_id: string | null }).owner_id === user.id;

  const log = await loadRevisions(supabase, id);
  if (log === null) return NextResponse.json({ ok: true, stored: false, isOwner, pending: [] });
  const cur = currentRevision(log);
  const failed = failedClaims(log);
  const answered = new Set(log.filter((r) => (r.kind === "approved" || r.kind === "rejected") && !failed.has(r.rev)).map((r) => (r.meta as Meta | null)?.of).filter((x): x is number => typeof x === "number"));

  // Who suggested which, from the history (a suggestion is an event the member recorded).
  const ev = await supabase.from("trip_events").select(EVENT_COLUMNS).eq("trip_id", id).eq("kind", "revision_proposed").order("occurred_at", { ascending: true }).limit(500);
  if (ev.error) return NextResponse.json({ ok: true, stored: false, isOwner, pending: [] });
  const by = new Map<number, string | null>();
  for (const e of ((ev.data ?? []) as EventRow[]).map(rowToEvent)) if (e && e.meta?.suggested === true && typeof e.meta.rev === "number" && !by.has(e.meta.rev)) by.set(e.meta.rev, e.userId ?? null);

  const members = await supabase.from("trip_members").select("user_id, display_name").eq("trip_id", id);
  const names = new Map(((members.data ?? []) as { user_id: string; display_name: string | null }[]).map((m) => [m.user_id, m.display_name?.trim() || "Someone on the trip"]));

  const now = Date.now();
  const pending = log
    .filter((r) => r.kind === "proposed" && by.has(r.rev) && !answered.has(r.rev))
    .filter((r) => (r.meta as Meta | null)?.base_rev === cur && (r.meta as Meta | null)?.feasible !== false)
    .filter((r) => !r.created_at || now - Date.parse(r.created_at) < PENDING_MAX_AGE_MS)
    .slice(0, 5)
    .map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      const who = by.get(r.rev) ?? null;
      return {
        rev: r.rev, suggestedBy: { id: who, name: who ? names.get(who) ?? "Someone on the trip" : "Someone on the trip" }, mine: who === user.id, createdAt: r.created_at ?? null,
        proposal: {
          strategy: m.strategy, label: m.label ?? "A suggested change", feasible: true, summary: m.summary ?? "", changes: m.changes ?? [], removals: m.removals ?? [], notPlaced: [], atRisk: m.atRisk ?? [],
          bookingConflicts: m.bookingConflicts ?? [], conditions: m.conditions ?? [], limitations: m.limitations ?? [], night: m.night ?? { arrivals: 0, drives: 0 }, dates: m.dates ?? null,
          unresolved: m.unresolved ?? [], days: [], rev: r.rev, canApprove: isOwner, canSuggest: false,
        },
      };
    });
  return NextResponse.json({ ok: true, stored: true, isOwner, baseRev: cur, pending }, { headers: { "Cache-Control": "private, no-store" } });
}
