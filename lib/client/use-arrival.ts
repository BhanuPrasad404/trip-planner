"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Me } from "@/lib/client/use-drive";
import type { VisitStatus } from "@/lib/client/visit-queue";
import { earlierUnvisited, initialArrival, resolveArrival, restoreHandled, serializeHandled, stepArrival, type ArrivalState, type ArrivalStop } from "@/lib/trip/arrival";

const memoryKey = (tripId: string) => `tm:arrival:${tripId}`;
const readHandled = (tripId: string) => { try { return restoreHandled(window.localStorage.getItem(memoryKey(tripId)), Date.now()); } catch { return {}; } };

export type ArrivalPromptView = { session: number; stopId: string; name: string; distanceM: number; accuracyM: number };
export type ArrivalUnsureView = { session: number; stopId: string; name: string; distanceM: number; accuracyM: number | null };
export type ArrivalDoneView = { stopId: string; name: string; queued: boolean; earlier: { id: string; name: string }[] };

type Args = {
  tripId: string;
  /** Today's stops in order, with the statuses the traveller can currently see (including answers still waiting to be sent). */
  stops: ArrivalStop[];
  /** Detection runs only while a drive is live and confirmed, with a precise position. */
  enabled: boolean;
  /** Changes every time a drive starts: a new drive begins with a clean slate (decisions made earlier are still remembered). */
  session: number;
  /** The drive hook calls this with every accepted GPS reading. */
  arrivalRef: MutableRefObject<((m: Me) => void) | null>;
  mark: (placeId: string, status: VisitStatus, name?: string) => Promise<"saved" | "queued">;
  /** Called once when we start asking about a stop (used to also tell the traveller outside the app). */
  onPrompt?: (stop: ArrivalStop, info: { distanceM: number }) => void;
};

/**
 * Arrival detection for a live drive. It decides when to ASK ("Mark this stop as visited?") and nothing more: the stop is marked only
 * when the traveller says yes. See lib/trip/arrival.ts for the rules (precise readings only, a real stay, no driving past, no repeats).
 */
export function useArrival({ tripId, stops, enabled, session, arrivalRef, mark, onPrompt }: Args) {
  const state = useRef<ArrivalState>(initialArrival());
  const stopsRef = useRef(stops);
  const enabledRef = useRef(enabled);
  const markRef = useRef(mark);
  const onPromptRef = useRef(onPrompt);
  const sessionRef = useRef(session);
  const mutedUnsure = useRef<Set<string>>(new Set());
  const [prompt, setPrompt] = useState<ArrivalPromptView | null>(null);
  const [unsure, setUnsure] = useState<ArrivalUnsureView | null>(null);
  const [done, setDone] = useState<ArrivalDoneView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { stopsRef.current = stops; enabledRef.current = enabled; markRef.current = mark; onPromptRef.current = onPrompt; sessionRef.current = session; });

  // Decisions made earlier (this trip, this phone) are remembered so a reload does not ask again. A new drive starts with a clean stay.
  useEffect(() => {
    state.current = initialArrival(readHandled(tripId));
    mutedUnsure.current = new Set();
  }, [tripId, session]);

  const persist = () => { try { window.localStorage.setItem(memoryKey(tripId), serializeHandled(state.current)); } catch { /* blocked: remembered for this visit only */ } };

  // Every accepted GPS reading goes through the engine. State is set from this callback (an event), not from an effect.
  useEffect(() => {
    arrivalRef.current = (m: Me) => {
      if (!enabledRef.current || m.manual) return;
      const r = stepArrival(state.current, { lat: m.lat, lng: m.lng, accuracyM: m.accuracyM, speedKmh: m.speedKmh, fixAt: m.fixAt, manual: m.manual }, stopsRef.current, Date.now());
      state.current = r.state;
      const named = (id: string) => stopsRef.current.find((s) => s.id === id);
      if (r.prompt) {
        const s = named(r.prompt.stopId);
        if (s) { setPrompt({ session: sessionRef.current, stopId: s.id, name: s.name, distanceM: r.prompt.distanceM, accuracyM: r.prompt.accuracyM }); setUnsure(null); onPromptRef.current?.(s, { distanceM: r.prompt.distanceM }); }
      } else if (r.unsure && !mutedUnsure.current.has(r.unsure.stopId) && !state.current.prompted) {
        const s = named(r.unsure.stopId);
        if (s) setUnsure({ session: sessionRef.current, stopId: s.id, name: s.name, distanceM: r.unsure.distanceM, accuracyM: r.unsure.accuracyM });
      }
    };
    return () => { arrivalRef.current = null; };
  }, [arrivalRef]);

  const visit = useCallback(async (stopId: string, name: string) => {
    setBusy(true);
    state.current = resolveArrival(state.current, stopId, "confirmed", Date.now());
    persist();
    setPrompt(null); setUnsure(null);
    const earlier = earlierUnvisited(stopsRef.current, stopId).map((s) => ({ id: s.id, name: s.name }));
    const result = await markRef.current(stopId, "done", name);
    setDone({ stopId, name, queued: result === "queued", earlier });
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads tripId and the state ref
  }, [tripId]);

  const confirm = useCallback(() => { if (prompt) void visit(prompt.stopId, prompt.name); }, [prompt, visit]);
  const dismiss = useCallback(() => {
    if (!prompt) return;
    state.current = resolveArrival(state.current, prompt.stopId, "dismissed", Date.now());
    persist();
    setPrompt(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads tripId and the state ref
  }, [prompt, tripId]);
  const confirmUnsure = useCallback(() => { if (unsure) void visit(unsure.stopId, unsure.name); }, [unsure, visit]);
  const dismissUnsure = useCallback(() => { if (unsure) { mutedUnsure.current.add(unsure.stopId); setUnsure(null); } }, [unsure]);

  /** "Not actually visited": back to planned, and don't ask again until the traveller leaves and returns. */
  const undo = useCallback(async () => {
    if (!done) return;
    state.current = resolveArrival(state.current, done.stopId, "dismissed", Date.now());
    persist();
    const d = done;
    setDone(null);
    await markRef.current(d.stopId, "planned", d.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads tripId and the state ref
  }, [done, tripId]);
  const skipEarlier = useCallback(async () => {
    if (!done || done.earlier.length === 0) return;
    const list = done.earlier;
    setDone((d) => (d ? { ...d, earlier: [] } : d));
    for (const e of list) await markRef.current(e.id, "skipped", e.name);
  }, [done]);
  const keepEarlier = useCallback(() => setDone((d) => (d ? { ...d, earlier: [] } : d)), []);
  const closeDone = useCallback(() => setDone(null), []);

  // A prompt is only for a stop that still exists and is still to be visited: never "you've arrived" at a deleted stop.
  const open = (id: string) => stops.some((s) => s.id === id && s.status === "planned");
  const doneView = done && stops.some((s) => s.id === done.stopId) ? { ...done, earlier: done.earlier.filter((e) => stops.some((s) => s.id === e.id)) } : null;
  return {
    prompt: enabled && prompt && prompt.session === session && open(prompt.stopId) ? prompt : null,
    unsure: enabled && unsure && unsure.session === session && open(unsure.stopId) ? unsure : null,
    done: doneView, busy, confirm, dismiss, confirmUnsure, dismissUnsure, undo, skipEarlier, keepEarlier, closeDone,
  };
}
