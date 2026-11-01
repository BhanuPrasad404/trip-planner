// How a change to a stop's progress is judged. Pure: no clock (the time is passed in), no database. The route
// (app/api/places/[id]/route.ts) reads the stop, asks these functions what to do, and does exactly that.
//
//   WHEN     `at` is when the traveller acted. A change made with no signal reaches the server hours later; recording the time it
//            arrived would make 2 PM into 10 PM. A time in the future is a phone clock that runs fast (clamped to now, and said so);
//            a time older than the outbox ever keeps is not believed (refused, never silently replaced by "now").
//   RETRY    the same `event_id` seen twice is the same change: the second is recognised, not applied again.
//   CONFLICT `expected` is the status the sender last saw. If the stop is somewhere else now (another device, an older queued
//            change), the change is NOT applied: the sender is told the current state (409) and decides. Nothing is overwritten.
//            A sender that gives no `expected` (an older app version) is judged as before: applied.
//   ARRIVAL  arriving is not visiting. It is recorded once (the first time wins), only for a stop still to be visited, and never
//            changes the status.
export type StopStatus = "planned" | "done" | "skipped";

/** A phone clock this far ahead of the server is not believed. */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** Longer than the outbox keeps a change (7 days) plus a day of slack. */
export const MAX_EVENT_AGE_MS = 8 * 24 * 3_600_000;

export type EventTime = { ok: true; at: string; clamped: boolean } | { ok: false; error: string };

export function eventTime(raw: string | undefined, nowMs: number): EventTime {
  if (raw === undefined) return { ok: true, at: new Date(nowMs).toISOString(), clamped: false };
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { ok: false, error: "That time isn't valid." };
  if (t > nowMs + MAX_FUTURE_SKEW_MS) return { ok: true, at: new Date(nowMs).toISOString(), clamped: true };
  if (nowMs - t > MAX_EVENT_AGE_MS) return { ok: false, error: "This change is too old to apply safely. Check the stop and mark it again." };
  return { ok: true, at: new Date(Math.min(t, nowMs)).toISOString(), clamped: false };
}

export type StatusRow = { status?: string | null; status_event_id?: string | null };
export type StatusDecision =
  | { kind: "apply" }
  | { kind: "duplicate" }
  | { kind: "unchanged" }
  | { kind: "conflict"; current: StopStatus };

const known = (s: unknown): s is StopStatus => s === "planned" || s === "done" || s === "skipped";

export function decideStatusChange(row: StatusRow, req: { status: StopStatus; expected?: StopStatus; event_id?: string }): StatusDecision {
  const current: StopStatus = known(row.status) ? row.status : "planned";
  if (req.event_id && row.status_event_id === req.event_id) return { kind: "duplicate" };
  if (current === req.status) return { kind: "unchanged" }; // already there, whoever put it there
  if (req.expected !== undefined && req.expected !== current) return { kind: "conflict", current };
  return { kind: "apply" };
}

/** What to say when a change was refused because the stop moved on. Plain words; the sender shows it as is. */
export function conflictMessage(current: StopStatus, wanted: StopStatus): string {
  const now = current === "planned" ? "still planned" : current === "done" ? "already marked done" : "already marked skipped";
  const want = wanted === "planned" ? "not visited" : wanted;
  return `This stop is ${now} (changed on another device or earlier), so your change to "${want}" was not applied. Check it and try again if you still want it.`;
}

export type ArrivalRow = { status?: string | null; arrived_at?: string | null; arrived_event_id?: string | null };
export type ArrivalDecision = { kind: "apply" } | { kind: "duplicate" } | { kind: "unchanged" };

export function decideArrival(row: ArrivalRow, req: { arrived: boolean; event_id?: string }): ArrivalDecision {
  if (req.event_id && row.arrived_event_id === req.event_id) return { kind: "duplicate" };
  if (req.arrived) {
    if (known(row.status) && row.status !== "planned") return { kind: "unchanged" }; // already visited or skipped: arriving adds nothing
    if (row.arrived_at) return { kind: "unchanged" }; // the first arrival time is the real one
    return { kind: "apply" };
  }
  return row.arrived_at ? { kind: "apply" } : { kind: "unchanged" };
}
