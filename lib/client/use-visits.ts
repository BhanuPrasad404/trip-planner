"use client";

import { useCallback } from "react";
import { useOutbox, type Outbox } from "@/lib/client/use-outbox";
import { newEventId, type VisitStatus } from "@/lib/client/outbox";

/**
 * "Mark visited / skipped" that survives having no signal — now one kind of change in the person's outbox (use-outbox.ts), so it is
 * kept per PERSON and trip (never shown to or sent by someone else on a shared phone). `mark` returns "saved" when the server
 * confirmed it at once, or "queued" when it is kept on the phone and will be sent when the connection is back.
 * `outbox` gives the page every waiting change (to show on top of the stops, and the "waiting to send" strip).
 */
export function useVisits(tripId: string, userId: string, onSynced: () => void, now: () => number = Date.now): { outbox: Outbox; mark: (placeId: string, status: VisitStatus, name?: string, expected?: VisitStatus) => Promise<"saved" | "queued">; arrive: (placeId: string, arrived: boolean, name?: string, evidence?: { source: "gps" | "manual"; accuracyM?: number }) => Promise<"saved" | "queued">; note: (kind: "passed_through" | "exploring_started", stop: { id: string; name: string }) => void; failed: string | null; clearFailed: () => void; syncing: boolean } {
  const outbox = useOutbox(tripId, userId, onSynced, now);
  const { send } = outbox;
  const mark = useCallback(async (placeId: string, status: VisitStatus, name?: string, expected?: VisitStatus): Promise<"saved" | "queued"> => {
    const r = await send({ kind: "status", placeId, status, ...(expected ? { expected } : {}) }, name);
    return r === "saved" ? "saved" : "queued"; // a refusal (or a conflict) is reported through `failed`, and the stop goes back to how the server has it
  }, [send]);
  /** "I've arrived" / "not here yet": recorded with the time the traveller said it. It never marks the stop visited. */
  const arrive = useCallback(async (placeId: string, arrived: boolean, name?: string, evidence?: { source: "gps" | "manual"; accuracyM?: number }): Promise<"saved" | "queued"> => {
    const r = await send({ kind: "arrive", placeId, arrived, ...(evidence?.source ? { source: evidence.source } : {}), ...(evidence?.accuracyM !== undefined && Number.isFinite(evidence.accuracyM) ? { accuracyM: Math.max(0, evidence.accuracyM) } : {}) }, name);
    return r === "saved" ? "saved" : "queued";
  }, [send]);
  /** What the traveller said about a place that is not a change of status ("just passing", "exploring"): a line in the journey's history. */
  const note = useCallback((kind: "passed_through" | "exploring_started", stop: { id: string; name: string }) => {
    void send({ kind: "journey", tripId, event: kind, eventId: newEventId(), source: "manual", placeId: stop.id, placeName: stop.name.slice(0, 120) }, stop.name);
  }, [send, tripId]);
  return { outbox, mark, arrive, note, failed: outbox.failed, clearFailed: outbox.clearFailed, syncing: outbox.syncing };
}
