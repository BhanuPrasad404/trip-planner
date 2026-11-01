import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { loadReplanInput, proposalMeta, snapshotWith } from "@/lib/server/replan-proposals";
import { recordEvent, recordRevision } from "@/lib/server/journey-events";
import { planStaleness, proposeReplan, strategiesFor, type Strategy } from "@/lib/trip/replan-proposal";
import { replanProposeSchema, uuid } from "@/lib/validation/schemas";
import { randomUUID } from "node:crypto";

export const maxDuration = 30;

/**
 * "The plan no longer matches what is happening: what are my options?" Returns PROPOSALS and changes nothing: the itinerary is only
 * ever changed by the traveller approving one stored proposal (../decide). Each proposal that could work is kept as a "proposed" revision
 * (so it can be shown again, approved, or declined, and so a stale one is recognised); one that cannot work is explained but not kept.
 * The traveller's position is used for this one request and never stored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, replanProposeSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  if (!rateLimiter.take(`trip-replan-propose:${user.id}`, 20, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);
  const body = parsed.data;

  const loaded = await loadReplanInput(supabase, id, user.id, body);
  if (!loaded.ok) return jsonError(loaded.error, loaded.status);
  const { input, places, baseRev, signature, commitSig, isOwner } = loaded;

  const open = input.stops.filter((s) => s.status === "planned" && s.day !== null);
  const stale = planStaleness({ stops: input.stops, journey: input.journey, nowDay: input.nowDay >= 1 ? input.nowDay : null, nowMin: input.nowMin, numDays: input.numDays, drivesFirstLegMin: firstLegMin(input, open) });
  const wanted: Strategy[] = body.strategies ?? strategiesFor(stale?.kind ?? "none", { notStarted: input.notStarted, hasOptional: open.some((s) => s.priority === "optional") });

  const out: Record<string, unknown>[] = [];
  for (const strategy of wanted) {
    const proposal = proposeReplan(input, strategy);
    let rev: number | null = null;
    if (proposal.feasible) {
      rev = await recordRevision(supabase, id, user.id, snapshotWith(places, proposal), `Suggested: ${proposal.label}`, { kind: "proposed", meta: proposalMeta(proposal, baseRev, signature, commitSig) });
      if (rev !== null) await recordEvent(supabase, { tripId: id, userId: user.id, kind: "revision_proposed", occurredAt: new Date().toISOString(), source: "system", clientEventId: randomUUID(), meta: { rev, strategy } }).catch(() => undefined);
    }
    out.push({ ...proposal, rev, canApprove: proposal.feasible && rev !== null && isOwner, canSuggest: proposal.feasible && rev !== null });
  }
  // A feasible proposal that could not be kept (a race, a full table) cannot be approved: say so rather than offering a button that fails.
  return NextResponse.json({ ok: true, isOwner, baseRev, stale, proposals: out, nowDay: input.nowDay, journey: input.journey });
}

/** Road minutes to the first stop of the day the traveller is on (for "the leaving time has passed"). */
function firstLegMin(input: Parameters<typeof proposeReplan>[0], open: { id: string; day: number | null; lat: number; lng: number; order: number | null }[]): number {
  const today = open.filter((s) => s.day === input.nowDay).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  if (!today || !input.origin) return 0;
  return Math.round(input.drive(input.origin, today).min);
}
