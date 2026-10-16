"use client";

import { useCallback } from "react";
import { useOutbox, type Outbox } from "@/lib/client/use-outbox";
import type { VisitStatus } from "@/lib/client/outbox";

/**
 * "Mark visited / skipped" that survives having no signal — now one kind of change in the person's outbox (use-outbox.ts), so it is
 * kept per PERSON and trip (never shown to or sent by someone else on a shared phone). `mark` returns "saved" when the server
 * confirmed it at once, or "queued" when it is kept on the phone and will be sent when the connection is back.
 * `outbox` gives the page every waiting change (to show on top of the stops, and the "waiting to send" strip).
 */
export function useVisits(tripId: string, userId: string, onSynced: () => void, now: () => number = Date.now): { outbox: Outbox; mark: (placeId: string, status: VisitStatus, name?: string) => Promise<"saved" | "queued">; failed: string | null; clearFailed: () => void; syncing: boolean } {
  const outbox = useOutbox(tripId, userId, onSynced, now);
  const { send } = outbox;
  const mark = useCallback(async (placeId: string, status: VisitStatus, name?: string): Promise<"saved" | "queued"> => {
    const r = await send({ kind: "status", placeId, status }, name);
    return r === "saved" ? "saved" : "queued"; // a refusal is reported through `failed`, and the stop goes back to how it was
  }, [send]);
  return { outbox, mark, failed: outbox.failed, clearFailed: outbox.clearFailed, syncing: outbox.syncing };
}
