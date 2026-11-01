import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { currentRevision, failedClaims, loadRevisions, recordEvent, recordRevision, type SnapshotRow } from "@/lib/server/journey-events";
import { scheduleSignature } from "@/lib/trip/replan-proposal";
import { replanUndoSchema, uuid } from "@/lib/validation/schemas";
import { requireOwner } from "@/lib/server/trip-owner";

type Meta = { from_dates?: { start_date: string | null; num_days: number }; of?: number; undo_of?: number };

/**
 * Take back the change that was just approved (the trip's owner only, like approving it). Allowed only for the newest approved change and only while the stops are exactly as that
 * change left them: if the traveller has moved, finished or added anything since, undoing would overwrite that, so it is refused (409) and
 * they correct it by hand. Undoing is itself recorded as a new approved revision (the history keeps every step; nothing is erased), and the
 * trip's dates go back to what they were.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, replanUndoSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  if (!rateLimiter.take(`trip-replan-undo:${user.id}`, 20, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  const owner = await requireOwner(supabase, id, user.id);
  if (!owner.ok) return jsonError(owner.error, owner.status);
  const log = await loadRevisions(supabase, id, true);
  if (log === null) return jsonError("Plan changes need a database update that hasn't been applied yet. Nothing was changed.", 503);
  const target = log.find((r) => r.rev === parsed.data.rev);
  const failed = failedClaims(log);
  // A change that could not be applied, or the note that says so, is not a change that can be undone.
  if (!target || target.kind !== "approved" || failed.has(target.rev) || (target.meta as { failed?: boolean } | null)?.failed === true) return jsonError("That change wasn't found.", 404);
  if (currentRevision(log) !== target.rev) return NextResponse.json({ error: "A newer change has been approved since, so this one can't be undone on its own.", code: "stale" }, { status: 409 });
  const previous = log.find((r) => r.rev < target.rev && (r.kind === "original" || r.kind === "approved") && !failed.has(r.rev));
  if (!previous?.snapshot) return jsonError("There is nothing earlier to go back to.", 422);

  const placesR = await supabase.from("places").select("id, name, lat, lng, day_number, sequence_order, arrival_time, status, drive_minutes, drive_km").eq("trip_id", id);
  if (placesR.error) return dbError(placesR.error, "undo: places");
  const places = (placesR.data ?? []) as { id: string; name: string; lat: number; lng: number; day_number: number | null; sequence_order: number | null; arrival_time: string | null; status: string | null; drive_minutes: number | null; drive_km: number | null }[];
  const targetSnap = (target.snapshot ?? []) as SnapshotRow[];
  // Compare only the stops still to do: finishing one since is a stop's own history, and undoing must never clobber it.
  const sigOf = (rows: { id: string; day: number | null; order: number | null }[]) => scheduleSignature(rows.map((r) => ({ ...r, status: "planned" })));
  const byId = new Map(places.map((p) => [p.id, p]));
  const asApproved = targetSnap.filter((s) => byId.has(s.id) && (byId.get(s.id)!.status ?? "planned") === "planned");
  const nowOpen = places.filter((p) => (p.status ?? "planned") === "planned");
  if (sigOf(asApproved.map((s) => ({ id: s.id, day: s.day, order: s.order }))) !== sigOf(nowOpen.map((p) => ({ id: p.id, day: p.day_number, order: p.sequence_order }))) || nowOpen.length !== asApproved.length) {
    return NextResponse.json({ error: "Your stops have changed since that was approved, so undoing it would overwrite your newer changes. Adjust them by hand instead.", code: "stale" }, { status: 409 });
  }

  const prevSnap = previous.snapshot as SnapshotRow[];
  const rev = await recordRevision(supabase, id, user.id, prevSnap, `Undid change ${target.rev}`, { kind: "approved", meta: { undo_of: target.rev } });
  if (rev === null) return NextResponse.json({ error: "Someone else changed the plan at the same moment. Try again.", code: "stale" }, { status: 409 });

  // Put the stops still to do back where they were; finished or skipped ones are never touched.
  const rows = prevSnap
    .filter((s) => byId.has(s.id) && (byId.get(s.id)!.status ?? "planned") === "planned")
    .filter((s) => { const p = byId.get(s.id)!; return p.day_number !== s.day || p.sequence_order !== s.order || (p.arrival_time ?? null) !== (s.arrival_time ?? null); })
    .map((s) => { const p = byId.get(s.id)!; return { id: s.id, trip_id: id, name: p.name, lat: p.lat, lng: p.lng, day_number: s.day, sequence_order: s.order, arrival_time: s.arrival_time, drive_minutes: s.drive_minutes, drive_km: s.drive_km }; });
  const from = ((target.meta ?? {}) as Meta).from_dates;
  const tripNow = await supabase.from("trips").select("start_date, num_days").eq("id", id).maybeSingle();
  const cur = tripNow.data as { start_date: string | null; num_days: number } | null;
  const backDates: Record<string, unknown> = {};
  if (from && cur) { if (from.start_date !== cur.start_date) { backDates.start_date = from.start_date; } if (from.num_days !== cur.num_days) backDates.num_days = from.num_days; }
  if (Object.keys(backDates).length) { const t = await supabase.from("trips").update(backDates).eq("id", id).select("id"); if (t.error) return jsonError("Couldn't put the trip's dates back, so nothing was changed.", 500); }
  if (rows.length) {
    const w = await supabase.from("places").upsert(rows, { onConflict: "id" });
    if (w.error) {
      if (cur && Object.keys(backDates).length) await supabase.from("trips").update({ start_date: cur.start_date, num_days: cur.num_days }).eq("id", id);
      return jsonError("Couldn't put your stops back, so nothing was changed.", 500);
    }
  }
  await recordEvent(supabase, { tripId: id, userId: user.id, kind: "manual_correction", occurredAt: new Date().toISOString(), source: "manual", clientEventId: randomUUID(), meta: { note: `Undid change ${target.rev}`, rev } }).catch(() => undefined);
  return NextResponse.json({ ok: true, rev, restored: rows.length });
}
