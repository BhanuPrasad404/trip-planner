// Marking a stop visited must work even with no signal: the traveller is often in a place with none. The answer is kept on THIS phone
// first, shown at once (so "next stop" moves on), and sent to the server as soon as there is a connection. Pure helpers, no React.
export type VisitStatus = "done" | "skipped" | "planned";
export type QueuedVisit = { placeId: string; status: VisitStatus; at: number };
export type SendResult = "ok" | "retry" | "failed";

/** A queued answer older than this is dropped rather than applied to a trip that has moved on. */
export const QUEUE_MAX_AGE_MS = 7 * 24 * 3_600_000;
export const queueKey = (tripId: string) => `tm:visits:${tripId}`;

export function parseQueue(raw: string | null, now: number): QueuedVisit[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(j?.items)) return [];
    return j.items.filter((x): x is QueuedVisit => {
      const v = x as Partial<QueuedVisit> | null;
      return !!v && typeof v.placeId === "string" && v.placeId.length > 0 && (v.status === "done" || v.status === "skipped" || v.status === "planned") && typeof v.at === "number" && Number.isFinite(v.at) && now - v.at <= QUEUE_MAX_AGE_MS;
    });
  } catch {
    return []; // damaged saved data must never break the page
  }
}

/** The newest answer for a stop replaces an older one (done, then undo, is just "planned"). */
export function enqueue(items: QueuedVisit[], next: QueuedVisit): QueuedVisit[] {
  return [...items.filter((i) => i.placeId !== next.placeId), next];
}
export const dequeue = (items: QueuedVisit[], placeId: string, at?: number): QueuedVisit[] => items.filter((i) => !(i.placeId === placeId && (at === undefined || i.at === at)));

/** Show what the traveller already answered, before the server has heard it. */
export function applyQueued<T extends { id: string; status?: string | null }>(places: T[], queue: QueuedVisit[]): T[] {
  if (queue.length === 0) return places;
  const by = new Map(queue.map((q) => [q.placeId, q.status]));
  return places.map((p) => (by.has(p.id) ? { ...p, status: by.get(p.id) as string } : p));
}

/**
 * Send one answer. "retry" = the network or the server had a problem, or the sign-in needs refreshing: keep it and try again later.
 * "failed" = the server refused it for good (the stop was removed, or you may not edit it): drop it and say so.
 */
export async function sendStatus(placeId: string, status: VisitStatus, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  try {
    const res = await fetchImpl(`/api/places/${placeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) return "ok";
    if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) return "retry";
    return "failed";
  } catch {
    return "retry";
  }
}
