// What changed in today's stops, and what the traveller must be told. Pure: no React, no network, no clock.
//
// The navigation target is always the FIRST remaining target (planned stops of the day in order, then the destination when it
// belongs to the drive — lib/map/drive-targets.ts). Done and skipped stops are never in that list. This module adds the part
// that was missing: noticing that a stop DISAPPEARED (deleted by me or by another member), so the traveller is told where they
// are going now, and so road legs measured through the deleted stop are never used again.

export type StopRef = { id: string; name: string };

export type StopChange =
  | { kind: "none" }
  /** The stop being driven to was deleted. `next` = the new target (null = nothing left today). */
  | { kind: "target-removed"; removed: StopRef; next: StopRef | null }
  /** Only stops further down the list were deleted: same target, new road legs. */
  | { kind: "later-removed"; removed: StopRef[] };

/** Ids that are not real places (the trip's destination) can never be "deleted" by deleting a place. */
const isPlaceId = (id: string) => !id.startsWith("__");

/**
 * Compare the targets shown before with the ones now.
 * `existingIds`: every place of the trip that still exists (any day, any status). A target that left the list but still exists
 * was finished, skipped or moved to another day — that is not a deletion and gets no "removed" message.
 * Several deletions at once (the next stop deleted too) simply give the first target that is still left.
 */
export function detectStopChange(args: { before: StopRef[]; after: StopRef[]; existingIds: ReadonlySet<string> }): StopChange {
  const removed = args.before.filter((t) => isPlaceId(t.id) && !args.existingIds.has(t.id));
  if (removed.length === 0) return { kind: "none" };
  const prevTarget = args.before[0];
  if (prevTarget && removed.some((r) => r.id === prevTarget.id)) {
    return { kind: "target-removed", removed: prevTarget, next: args.after[0] ?? null };
  }
  return { kind: "later-removed", removed };
}

export function stopChangeMessage(c: StopChange): string | null {
  if (c.kind !== "target-removed") return null;
  return c.next ? `A stop was removed. Going to ${c.next.name} now.` : "A stop was removed. There are no more stops today.";
}

/**
 * A short fingerprint of the trip's stops, enough to notice any add / delete / reorder / status change. Used by the light
 * "anything new?" check while driving: it reads 4 small columns instead of reloading the whole page.
 */
export type StopRow = { id: string; status?: string | null; day_number?: number | null; sequence_order?: number | null };
export function stopsSignature(rows: readonly StopRow[]): string {
  return rows
    .map((r) => `${r.id}:${r.status ?? "planned"}:${r.day_number ?? "-"}:${r.sequence_order ?? "-"}`)
    .sort()
    .join("|");
}

/**
 * A road route belongs to EXACTLY these targets, in this order — or it must not be used. A route measured through a stop that
 * was deleted (or for an older order) has a leg for every old stop, so pairing it with the new list adds or mislabels legs.
 */
export function routeMatchesTargets(routeStopIds: readonly string[] | null | undefined, targetIds: readonly string[], maxStops: number): boolean {
  if (!routeStopIds) return false;
  const want = targetIds.slice(0, maxStops);
  return routeStopIds.length === want.length && routeStopIds.every((id, i) => id === want[i]);
}

// ── Remembered across sleep / reload ──
// The phone may be asleep, offline or reloaded when the stop is deleted. What we were heading for is remembered on the device
// (just ids and names of this trip's own stops, never anyone's position), so the message still appears when it comes back.
export type RememberedTargets = { v: 1; at: number; targets: StopRef[] };
export const REMEMBER_MS = 12 * 3_600_000;
/** Per PERSON and trip (a shared phone never shows one person's stops to the next). */
export const rememberKey = (userId: string, tripId: string) => `tm:nav-targets:${userId}:${tripId}`;

export function encodeRemembered(targets: StopRef[], nowMs: number): string {
  const r: RememberedTargets = { v: 1, at: nowMs, targets: targets.slice(0, 20).map((t) => ({ id: t.id, name: t.name.slice(0, 120) })) };
  return JSON.stringify(r);
}

export function decodeRemembered(raw: string | null, nowMs: number): StopRef[] | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<RememberedTargets>;
    if (r.v !== 1 || typeof r.at !== "number" || !Array.isArray(r.targets) || nowMs - r.at > REMEMBER_MS || r.at > nowMs + 60_000) return null;
    const ok = r.targets.filter((t): t is StopRef => !!t && typeof t.id === "string" && typeof t.name === "string");
    return ok.length ? ok : null;
  } catch {
    return null;
  }
}
