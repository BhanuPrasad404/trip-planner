"use client";

import { useCallback, useEffect, useState } from "react";
import { newEventId } from "@/lib/client/outbox";
import { useLocalJson } from "@/lib/client/use-local-json";
import type { JourneyState } from "@/lib/trip/journey";
import type { Proposal, Staleness, Strategy } from "@/lib/trip/replan-proposal";

export type ProposalDTO = Proposal & { /** The stored suggestion's number; null when it could not be kept (then it cannot be approved). */ rev: number | null; /** True only for the trip's owner: the server decides, and refuses anyone else. */ canApprove: boolean; /** A member who is not the owner can send this one to the owner. */ canSuggest?: boolean };
export type PendingSuggestion = { rev: number; suggestedBy: { id: string | null; name: string }; mine: boolean; createdAt: string | null; proposal: ProposalDTO };
export type ProposeAnswer = { isOwner?: boolean; baseRev: number | null; stale: Staleness | null; proposals: ProposalDTO[]; nowDay: number; journey: JourneyState };
export type AskOptions = { strategies?: Strategy[]; nightDriving?: boolean; keep?: string[]; drop?: string[] };

type State = {
  pending: PendingSuggestion[]; isOwner: boolean; suggested: number[];
  status: "idle" | "asking" | "ready" | "error";
  answer: ProposeAnswer | null;
  error: string | null;
  /** Which suggestion is being answered right now. */
  busy: number | null;
  applied: { rev: number; label: string; changed: number } | null;
  opts: { nightDriving: boolean; keep: string[]; drop: string[]; strategies?: Strategy[] };
};
const START: State = { pending: [], isOwner: false, suggested: [], status: "idle", answer: null, error: null, busy: null, applied: null, opts: { nightDriving: false, keep: [], drop: [] } };

/** One question about a delay is asked once, then not again for this long (so the app never nags). */
export const NUDGE_QUIET_MS = 12 * 3_600_000;
export const nudgeKey = (tripId: string) => `tm:plan-nudge:${tripId}`;
const EMPTY_NUDGE: { key?: string; at?: number } = {};

type Args = { tripId: string; localDate: string | null; localTime: string | null; position: { lat: number; lng: number } | null; onChanged: () => void; now?: () => number; /** The traveller's own preferences, sent with every request. */ prefs?: { nightDriving: boolean; pace: string } };

async function call(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "No connection. Nothing was changed. Try again when you're back online." } };
  }
}

/**
 * Ways to deal with a plan that no longer matches what is happening: ask for options, look at them, approve one, decline one, undo it.
 * Nothing changes until `approve`. The traveller's position is sent for the one request that asks and is never kept.
 */
export function usePlanChange({ tripId, localDate, localTime, position, onChanged, now = Date.now, prefs }: Args) {
  const [s, setS] = useState<State>(START);
  const [nudge, setNudge] = useLocalJson<{ key?: string; at?: number }>(nudgeKey(tripId), EMPTY_NUDGE);

  /** What members have suggested to the owner and nobody has answered. Read, never changed, by anyone but the owner's decision. */
  const loadPending = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/replan/pending`, { cache: "no-store" });
      if (!res.ok) return;
      const b = (await res.json()) as { isOwner?: boolean; pending?: PendingSuggestion[] };
      setS((c) => ({ ...c, isOwner: !!b.isOwner, pending: Array.isArray(b.pending) ? b.pending : [] }));
    } catch { /* offline: what is on screen stays */ }
  }, [tripId]);
  useEffect(() => {
    const t = window.setTimeout(() => void loadPending(), 0);
    return () => window.clearTimeout(t);
  }, [loadPending]);

  const ask = useCallback(async (o: AskOptions = {}) => {
    if (!localDate || !localTime) return;
    setS((c) => ({ ...c, status: "asking", error: null, applied: null, opts: { nightDriving: o.nightDriving ?? c.opts.nightDriving, keep: o.keep ?? c.opts.keep, drop: o.drop ?? c.opts.drop, strategies: o.strategies ?? c.opts.strategies } }));
    const keep = o.keep ?? s.opts.keep, drop = o.drop ?? s.opts.drop, night = o.nightDriving ?? prefs?.nightDriving ?? s.opts.nightDriving, strategies = o.strategies ?? s.opts.strategies;
    const r = await call(`/api/trips/${tripId}/replan/propose`, {
      local_date: localDate, local_time: localTime, night_driving: night, ...(prefs ? { pace: prefs.pace } : {}),
      ...(strategies?.length ? { strategies } : {}), ...(keep.length ? { keep } : {}), ...(drop.length ? { drop } : {}),
      ...(position ? { lat: position.lat, lng: position.lng } : {}),
    });
    if (!r.ok) { setS((c) => ({ ...c, status: "error", error: String(r.data.error ?? "Couldn't work out your options. Nothing was changed.") })); return; }
    setS((c) => ({ ...c, status: "ready", answer: r.data as unknown as ProposeAnswer }));
  }, [localDate, localTime, position, prefs, s.opts, tripId]);

  const approve = useCallback(async (rev: number) => {
    setS((c) => ({ ...c, busy: rev, error: null }));
    const r = await call(`/api/trips/${tripId}/replan/decide`, { proposal_rev: rev, decision: "approve" });
    if (!r.ok) {
      setS((c) => ({ ...c, busy: null, error: String(r.data.error ?? "Couldn't apply that. Nothing was changed.") }));
      if (r.status === 409) void ask(); // out of date: show what is true now
      return;
    }
    const label = s.answer?.proposals.find((p) => p.rev === rev)?.label ?? s.pending.find((p) => p.rev === rev)?.proposal.label ?? "Your plan";
    setS((c) => ({ ...c, busy: null, answer: null, status: "idle", pending: c.pending.filter((x) => x.rev !== rev), applied: { rev: Number(r.data.rev), label, changed: Number(r.data.changed) || 0 } }));
    onChanged();
    void loadPending();
  }, [ask, loadPending, onChanged, s.answer, s.pending, tripId]);

  const decline = useCallback(async (rev: number) => {
    setS((c) => ({ ...c, busy: rev, error: null }));
    const r = await call(`/api/trips/${tripId}/replan/decide`, { proposal_rev: rev, decision: "reject" });
    setS((c) => ({
      ...c, busy: null,
      ...(r.ok ? { answer: c.answer ? { ...c.answer, proposals: c.answer.proposals.filter((p) => p.rev !== rev) } : null, pending: c.pending.filter((x) => x.rev !== rev) } : { error: String(r.data.error ?? "Couldn't save that.") }),
    }));
  }, [tripId]);

  const undo = useCallback(async () => {
    if (!s.applied) return;
    setS((c) => ({ ...c, busy: c.applied?.rev ?? null, error: null }));
    const r = await call(`/api/trips/${tripId}/replan/undo`, { rev: s.applied.rev });
    setS((c) => ({ ...c, busy: null, ...(r.ok ? { applied: null } : { error: String(r.data.error ?? "Couldn't undo that.") }) }));
    if (r.ok) onChanged();
  }, [onChanged, s.applied, tripId]);

  /** A member who is not the owner sends one of the stored options to the owner. It changes nothing; the owner sees it and decides. */
  const suggest = useCallback(async (rev: number) => {
    setS((c) => ({ ...c, busy: rev, error: null }));
    const r = await call(`/api/trips/${tripId}/events`, { kind: "revision_proposed", client_event_id: newEventId(), source: "manual", meta: { rev, suggested: true } });
    setS((c) => ({ ...c, busy: null, ...(r.ok ? { suggested: [...c.suggested, rev] } : { error: String(r.data.error ?? "Couldn't send that to the trip owner.") }) }));
    if (r.ok) void loadPending();
  }, [loadPending, tripId]);

  const reset = useCallback(() => setS((c) => ({ ...START, opts: c.opts, applied: null, pending: c.pending, isOwner: c.isOwner, suggested: c.suggested })), []);
  const closeApplied = useCallback(() => setS((c) => ({ ...c, applied: null })), []);

  /** The question for this situation was answered ("keep my plan"): not asked again for a while. */
  const quiet = (key: string | null) => !!key && nudge.key === key && typeof nudge.at === "number" && now() - nudge.at < NUDGE_QUIET_MS;
  const dismissNudge = useCallback((key: string) => setNudge({ key, at: now() }), [now, setNudge]);

  return { ...s, ask, approve, decline, undo, reset, closeApplied, quiet, dismissNudge, suggest, loadPending };
}
export type PlanChange = ReturnType<typeof usePlanChange>;
