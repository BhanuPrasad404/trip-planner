import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { currentRevision, failedClaims, loadRevisions, recordEvent, recordRevision, type RevisionRow, type SnapshotRow } from "@/lib/server/journey-events";
import { scheduleSignature } from "@/lib/trip/replan-proposal";
import { commitmentsSignature, loadCommitments } from "@/lib/server/commitments";
import { replanDecideSchema, uuid } from "@/lib/validation/schemas";
import { requireOwner } from "@/lib/server/trip-owner";

type Meta = { commit_sig?: string; strategy?: string; label?: string; base_rev?: number | null; signature?: string; dates?: { startDate: string | null; numDays: number; startShiftDays: number; extraDays: number }; of?: number };

/**
 * The trip's OWNER answers ONE stored proposal (any member may suggest; only the owner approves or declines: a 403 for anyone else, checked here
 * and again by the database). Approving applies exactly that proposal (the schedule saved with it), never anything sent
 * from the screen, and only if it is still true: the plan the proposal was made against must still be the current approved one, no
 * stop may have changed since, and nobody may have answered it already. Otherwise: 409, and the traveller asks again. Declining keeps it
 * as history. Whatever happens, the original itinerary and every earlier revision stay as they were.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, replanDecideSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  if (!rateLimiter.take(`trip-replan-decide:${user.id}`, 20, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);
  const { proposal_rev: proposalRev, decision, note } = parsed.data;
  const owner = await requireOwner(supabase, id, user.id);
  if (!owner.ok) return jsonError(owner.error, owner.status);

  const log = await loadRevisions(supabase, id, true);
  if (log === null) return jsonError("Plan changes need a database update that hasn't been applied yet, so they can't be saved right now. Nothing was changed.", 503);
  const proposal = log.find((r) => r.rev === proposalRev);
  if (!proposal || proposal.kind !== "proposed") return jsonError("That suggestion wasn't found.", 404);
  const meta = (proposal.meta ?? {}) as Meta;
  const failed = failedClaims(log);
  const answered = log.find((r: RevisionRow) => (r.kind === "approved" || r.kind === "rejected") && ((r.meta ?? {}) as Meta).of === proposalRev && !failed.has(r.rev));
  if (answered) return NextResponse.json({ error: answered.kind === "approved" ? "This change was already approved." : "This suggestion was already declined.", code: "answered" }, { status: 409 });

  const snapshot = (proposal.snapshot ?? []) as SnapshotRow[];
  const event = (kind: "revision_approved" | "revision_rejected", rev: number | null) => recordEvent(supabase, { tripId: id, userId: user.id, kind, occurredAt: new Date().toISOString(), source: "manual", clientEventId: randomUUID(), meta: { rev: rev ?? proposalRev, of: proposalRev, ...(meta.strategy ? { strategy: meta.strategy } : {}), ...(note ? { note } : {}) } }).catch(() => undefined);

  if (decision === "reject") {
    const rev = await recordRevision(supabase, id, user.id, snapshot, note ? `Declined: ${note}` : "Declined", { kind: "rejected", meta: { of: proposalRev, strategy: meta.strategy } });
    if (rev === null) return jsonError("Couldn't save that. Nothing was changed.", 500);
    await event("revision_rejected", rev);
    return NextResponse.json({ ok: true, decision, rev });
  }

  // Is it still true? The places as they are now, and the plan it was made against.
  const placesR = await supabase.from("places").select("id, name, lat, lng, day_number, sequence_order, arrival_time, status, drive_minutes, drive_km").eq("trip_id", id);
  if (placesR.error) return dbError(placesR.error, "decide: places");
  const places = (placesR.data ?? []) as { id: string; name: string; lat: number; lng: number; day_number: number | null; sequence_order: number | null; arrival_time: string | null; status: string | null; drive_minutes: number | null; drive_km: number | null }[];
  const nowSig = scheduleSignature(places.map((p) => ({ id: p.id, day: p.day_number, order: p.sequence_order, status: p.status })));
  const cur = currentRevision(log);
  if ((meta.base_rev ?? null) !== cur || meta.signature !== nowSig) {
    return NextResponse.json({ error: "Your plan has changed since this was suggested (a stop was moved, finished or added, or another change was approved). Ask for new suggestions so you approve something that is true now.", code: "stale" }, { status: 409 });
  }
  // A booking added, changed or removed since the suggestion was made can change whether it is allowed: it is asked about again.
  if (meta.commit_sig !== undefined && meta.commit_sig !== commitmentsSignature(await loadCommitments(supabase, id))) {
    return NextResponse.json({ error: "Your bookings have changed since this was suggested. Ask for new suggestions so they take your bookings into account.", code: "stale" }, { status: 409 });
  }
  const tripR = await supabase.from("trips").select("id, num_days, start_date").eq("id", id).maybeSingle();
  if (tripR.error || !tripR.data) return tripR.error ? dbError(tripR.error, "decide: trip") : jsonError("Trip not found", 404);
  const trip = tripR.data as { num_days: number; start_date: string | null };

  // The stops that would change. A finished or skipped stop is never among them, whatever the stored schedule says.
  const byId = new Map(places.map((p) => [p.id, p]));
  const changed = snapshot.filter((s) => {
    const p = byId.get(s.id);
    return !!p && (p.status ?? "planned") === "planned" && (p.day_number !== s.day || p.sequence_order !== s.order || (p.arrival_time ?? null) !== (s.arrival_time ?? null));
  });

  // Claim the new revision FIRST: the unique revision number is what stops two people approving at once. The loser gets a 409.
  const rev = await recordRevision(supabase, id, user.id, snapshot, meta.label ? `Approved: ${meta.label}` : "Approved", { kind: "approved", meta: { of: proposalRev, strategy: meta.strategy, base_rev: cur, from_dates: { start_date: trip.start_date, num_days: trip.num_days } } });
  if (rev === null) return NextResponse.json({ error: "Someone else changed the plan at the same moment. Ask for new suggestions.", code: "stale" }, { status: 409 });
  // Two people approving the SAME proposal at once each get their own revision number. The lowest one wins and applies it; the other
  // stands down (the schedule it holds is the same one, so nothing is lost or applied twice).
  const after = await loadRevisions(supabase, id);
  const rivals = after?.filter((r) => r.kind === "approved" && ((r.meta ?? {}) as Meta).of === proposalRev && !failedClaims(after).has(r.rev)).map((r) => r.rev) ?? [rev];
  if (Math.min(...rivals) !== rev) return NextResponse.json({ error: "This change was approved at the same moment by someone else, and is being applied.", code: "answered" }, { status: 409 });

  const dates = meta.dates;
  const tripPatch: Record<string, unknown> = {};
  if (dates && dates.startDate && dates.startDate !== trip.start_date) { tripPatch.start_date = dates.startDate; tripPatch.start_time = null; } // a moved start date clears a late start time, as everywhere else
  if (dates && dates.numDays > trip.num_days) tripPatch.num_days = dates.numDays;
  // If applying fails after the new revision was claimed, put the history back in step with reality: a NEWER approved row that restores the plan
  // that is really in force (so "the current approved plan" is never one that was not applied), and say so. Nothing is ever deleted.
  const restoreHistory = async (why: string) => {
    const inForce = log.find((r) => r.rev === cur && r.snapshot);
    if (inForce?.snapshot) await recordRevision(supabase, id, user.id, inForce.snapshot as SnapshotRow[], `Not applied: ${why}`, { kind: "approved", meta: { undo_of: rev, failed: true, of: undefined } });
  };
  const revert = async () => { if (Object.keys(tripPatch).length) await supabase.from("trips").update({ ...(tripPatch.start_date ? { start_date: trip.start_date } : {}), ...(tripPatch.num_days ? { num_days: trip.num_days } : {}) }).eq("id", id); };
  if (Object.keys(tripPatch).length) {
    let t = await supabase.from("trips").update(tripPatch).eq("id", id).select("id");
    if (t.error && "start_time" in tripPatch) { const { start_time: _unused, ...rest } = tripPatch; void _unused; t = await supabase.from("trips").update(rest).eq("id", id).select("id"); } // no start_time column yet
    if (t.error) { await restoreHistory("the trip's dates couldn't be updated"); return jsonError("Couldn't change the trip's dates, so nothing was changed.", 500); }
  }
  if (changed.length > 0) {
    const rows = changed.map((s) => { const p = byId.get(s.id)!; return { id: s.id, trip_id: id, name: p.name, lat: p.lat, lng: p.lng, day_number: s.day, sequence_order: s.order, arrival_time: s.arrival_time, drive_minutes: s.drive_minutes, drive_km: s.drive_km }; });
    const w = await supabase.from("places").upsert(rows, { onConflict: "id" });
    if (w.error) {
      await revert();
      await restoreHistory("the stops couldn't be updated");
      return jsonError("Couldn't update your stops, so nothing was changed.", 500);
    }
  }
  await event("revision_approved", rev);
  return NextResponse.json({ ok: true, decision, rev, changed: changed.length, dates: tripPatch });
}
