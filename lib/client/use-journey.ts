"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newEventId } from "@/lib/client/outbox";
import { useLocalJson } from "@/lib/client/use-local-json";
import type { Outbox } from "@/lib/client/use-outbox";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { allowedActions, buildTimeline, deriveJourney, JOURNEY_KINDS, type JourneyEvent, type JourneyKind, type TimelineRow } from "@/lib/trip/journey";

/** What this phone remembers of the trip's journey so it can show it with no signal. The server is the truth; this is only a copy. */
export const journeyCacheKey = (userId: string, tripId: string) => `tm:journey:${userId}:${tripId}`;
const EMPTY = { events: [] as JourneyEvent[] };
const known = new Set<string>(JOURNEY_KINDS);

const valid = (e: unknown): e is JourneyEvent => {
  const v = e as Partial<JourneyEvent> | null;
  return !!v && typeof v.clientEventId === "string" && typeof v.kind === "string" && known.has(v.kind) && typeof v.occurredAt === "string" && Number.isFinite(Date.parse(v.occurredAt)) && (v.source === "gps" || v.source === "manual" || v.source === "system");
};

export type RecordOptions = { source: "gps" | "manual"; accuracyM?: number; /** A place NAME ("Vijayawada") the traveller allowed; never coordinates. */ from?: string | null; placeId?: string; placeName?: string; note?: string; /** Small extra details (a correction says which event, and what to do with it). */ meta?: Record<string, string | number | boolean> };

/**
 * The journey as the traveller sees it: the trip's real events (from the server, with a copy kept on this phone), what is still waiting
 * to be sent, and what the journey is doing now. Recording goes through the person's outbox, so leaving, pausing or resting works with no
 * signal, keeps the time the person pressed the button, and is sent once (every event has its own id).
 */
export function useJourney({ tripId, userId, outbox, closed, offsetMin = INDIA_UTC_OFFSET_MIN, nowMs }: { tripId: string; userId: string; outbox: Outbox; closed: boolean; offsetMin?: number; nowMs?: number }) {
  const [cache, setCache] = useLocalJson<{ events: JourneyEvent[] }>(journeyCacheKey(userId, tripId), EMPTY);
  const [stored, setStored] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const events = useMemo(() => (Array.isArray(cache.events) ? cache.events.filter(valid) : []), [cache]);
  const setCacheRef = useRef(setCache);
  useEffect(() => { setCacheRef.current = setCache; });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/events`, { cache: "no-store" });
      if (!res.ok) return; // offline or a server problem: keep showing the copy on this phone
      const body = (await res.json()) as { stored?: boolean; events?: unknown[] };
      setStored(body.stored !== false);
      if (body.stored !== false && Array.isArray(body.events)) setCacheRef.current({ events: body.events.filter(valid) });
    } catch { /* offline: the copy on this phone stays */ }
  }, [tripId]);

  const waiting = outbox.items.filter((i): i is Extract<typeof i, { kind: "journey" }> => i.kind === "journey" && i.tripId === tripId);
  // On opening, and again whenever something was sent or is waiting (not while it is being sent: the answer would be out of date).
  useEffect(() => {
    if (outbox.syncing) return;
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load, waiting.length, outbox.syncing]);

  const pending = useMemo<JourneyEvent[]>(
    () => waiting.map((i) => ({ clientEventId: i.eventId, kind: i.event, occurredAt: new Date(i.at).toISOString(), source: i.source, accuracyM: i.accuracyM ?? null, placeName: i.placeName ?? null, userId, meta: i.meta ?? {} })),
    [waiting, userId]
  );
  // The state counts what is waiting too, so the buttons are right at once, even with no signal.
  const mine = useMemo(() => [...events.filter((e) => !e.userId || e.userId === userId), ...pending], [events, pending, userId]);
  const journey = useMemo(() => deriveJourney(mine), [mine]);
  const actions = useMemo(() => allowedActions(journey.state, closed), [journey.state, closed]);
  const rows = useMemo<TimelineRow[]>(() => buildTimeline(events, { offsetMin, me: userId, pending, nowMs }), [events, pending, offsetMin, userId, nowMs]);

  const record = useCallback(async (kind: JourneyKind, o: RecordOptions): Promise<"saved" | "queued" | "failed"> => {
    setError(null);
    const r = await outbox.send({
      kind: "journey", tripId, event: kind, eventId: newEventId(), source: o.source,
      ...(o.accuracyM !== undefined && Number.isFinite(o.accuracyM) ? { accuracyM: Math.max(0, o.accuracyM) } : {}),
      ...(o.placeName ? { placeName: o.placeName.slice(0, 120) } : {}),
      ...(o.from || o.note || o.meta ? { meta: { ...(o.meta ?? {}), ...(o.from ? { from: o.from.slice(0, 120) } : {}), ...(o.note ? { note: o.note.slice(0, 200) } : {}) } } : {}),
    });
    if (r === "saved") await load(); // the server has it: show the history as the server holds it
    if (r === "failed") setError(null); // the reason is shown by the outbox's own message
    return r;
  }, [outbox, tripId, load]);

  /**
   * Put right one of the person's OWN events: "that didn't happen" (void) or "that was really at this time" (retime). It is a new line in
   * the history; the original stays, marked. The server refuses a correction that would leave the journey out of order, and says why.
   */
  const correct = useCallback((target: string, action: "void" | "retime", at?: string) => record("manual_correction", { source: "manual", meta: { target, action, ...(action === "retime" && at ? { at } : {}) } }), [record]);

  return { journey, actions, rows, record, correct, events, problem: outbox.failed, stored, pendingCount: waiting.length, error, reload: load };
}
export type JourneyApi = ReturnType<typeof useJourney>;
