"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Me } from "@/lib/client/use-drive";
import type { VisitStatus } from "@/lib/client/visit-queue";
import { earlierUnvisited, initialArrival, resolveArrival, restoreHandled, serializeHandled, stepArrival, zoneFor, type ArrivalState, type ArrivalStop } from "@/lib/trip/arrival";

/** Per PERSON and trip: on a shared phone, one person's answers never silence or prompt the next person. */
export const arrivalMemoryKey = (userId: string, tripId: string) => `tm:arrival:${userId}:${tripId}`;
const readHandled = (key: string) => { try { return restoreHandled(window.localStorage.getItem(key), Date.now()); } catch { return {}; } };

export type ArrivalPromptView = { session: number; stopId: string; name: string; distanceM: number; accuracyM: number; area: boolean; destination: boolean };
export type ArrivalUnsureView = { session: number; stopId: string; name: string; distanceM: number; accuracyM: number | null };
export type ArrivalDoneView = { stopId: string; name: string; queued: boolean; earlier: { id: string; name: string }[] };
/** "Arriving in 80 m": the stop you are about to reach, with the latest distance. */
export type ApproachView = { session: number; stopId: string; name: string; distanceM: number; area: boolean };

type Args = {
  tripId: string;
  userId: string;
  /** Today's stops in order (plus the trip's destination when it ends this drive), with the statuses the traveller can currently see. */
  stops: ArrivalStop[];
  /** The stop the traveller is heading for: the only one announced as "approaching". Omitted: any open stop. */
  targetId?: string | null;
  /** Detection runs only while a drive is live and confirmed, with a precise position. */
  enabled: boolean;
  /** Changes every time a drive starts: a new drive begins with a clean slate (decisions made earlier are still remembered). */
  session: number;
  /** The drive hook calls this with every accepted GPS reading. */
  arrivalRef: MutableRefObject<((m: Me) => void) | null>;
  mark: (placeId: string, status: VisitStatus, name?: string) => Promise<"saved" | "queued">;
  /** Called once per stop per drive when "approaching" starts (chime, voice, phone notification). */
  onApproach?: (stop: ArrivalStop, info: { distanceM: number }) => void;
  /** Called once when we start asking about a stop (chime, voice, phone notification). */
  onPrompt?: (stop: ArrivalStop, info: { distanceM: number; area: boolean }) => void;
  /** Arrived at the trip's destination and the traveller said so: end the drive (the destination is not "marked done"). */
  onFinish?: () => void;
};

/**
 * Arrival detection for a live drive. It decides when to TELL ("Arriving in 100 m") and when to ASK ("You have arrived at X")
 * and nothing more: the stop is marked only when the traveller says so. See lib/trip/arrival.ts for the rules.
 */
export function useArrival({ tripId, userId, stops, targetId, enabled, session, arrivalRef, mark, onApproach, onPrompt, onFinish }: Args) {
  const memoryKey = arrivalMemoryKey(userId, tripId);
  const state = useRef<ArrivalState>(initialArrival());
  const stopsRef = useRef(stops);
  const enabledRef = useRef(enabled);
  const markRef = useRef(mark);
  const targetRef = useRef(targetId);
  const cb = useRef({ onApproach, onPrompt, onFinish });
  const sessionRef = useRef(session);
  const mutedUnsure = useRef<Set<string>>(new Set());
  const [prompt, setPrompt] = useState<ArrivalPromptView | null>(null);
  const [unsure, setUnsure] = useState<ArrivalUnsureView | null>(null);
  const [done, setDone] = useState<ArrivalDoneView | null>(null);
  const [near, setNear] = useState<ApproachView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { stopsRef.current = stops; enabledRef.current = enabled; markRef.current = mark; targetRef.current = targetId; cb.current = { onApproach, onPrompt, onFinish }; sessionRef.current = session; });

  // Decisions made earlier (this trip, this phone) are remembered so a reload does not ask again. A new drive starts with a clean stay.
  useEffect(() => {
    state.current = initialArrival(readHandled(memoryKey));
    mutedUnsure.current = new Set();
  }, [memoryKey, session]);

  const persist = () => { try { window.localStorage.setItem(memoryKey, serializeHandled(state.current)); } catch { /* blocked: remembered for this visit only */ } };

  // Every accepted GPS reading goes through the engine. State is set from this callback (an event), not from an effect.
  useEffect(() => {
    arrivalRef.current = (m: Me) => {
      if (!enabledRef.current || m.manual) return;
      const r = stepArrival(state.current, { lat: m.lat, lng: m.lng, accuracyM: m.accuracyM, speedKmh: m.speedKmh, fixAt: m.fixAt, manual: m.manual }, stopsRef.current, Date.now(), targetRef.current === undefined ? {} : { targetId: targetRef.current });
      state.current = r.state;
      const named = (id: string) => stopsRef.current.find((s) => s.id === id);
      // "Arriving in … m" follows the engine's hysteresis; the distance is rounded to 10 m so the screen does not churn.
      const n = r.state.near ? named(r.state.near.stopId) : null;
      const nextNear = n && r.state.near ? { session: sessionRef.current, stopId: n.id, name: n.name, distanceM: Math.max(10, Math.round(r.state.near.distanceM / 10) * 10), area: zoneFor(n.category).area } : null;
      setNear((cur) => (cur?.stopId === nextNear?.stopId && cur?.distanceM === nextNear?.distanceM && cur?.session === nextNear?.session ? cur : nextNear));
      // The traveller drove away without answering: the card comes down (and the next stop's strip and prompt can show).
      if (r.withdrawn) { const id = r.withdrawn; setPrompt((cur) => (cur?.stopId === id ? null : cur)); }
      if (r.approach) {
        const s = named(r.approach.stopId);
        if (s) cb.current.onApproach?.(s, { distanceM: r.approach.distanceM });
      }
      if (r.prompt) {
        const s = named(r.prompt.stopId);
        if (s) {
          setPrompt({ session: sessionRef.current, stopId: s.id, name: s.name, distanceM: r.prompt.distanceM, accuracyM: r.prompt.accuracyM, area: r.prompt.area, destination: s.kind === "destination" });
          setUnsure(null);
          cb.current.onPrompt?.(s, { distanceM: r.prompt.distanceM, area: r.prompt.area });
        }
      } else if (r.unsure && !mutedUnsure.current.has(r.unsure.stopId) && !state.current.prompted) {
        const s = named(r.unsure.stopId);
        if (s && s.kind !== "destination") setUnsure({ session: sessionRef.current, stopId: s.id, name: s.name, distanceM: r.unsure.distanceM, accuracyM: r.unsure.accuracyM });
      }
    };
    return () => { arrivalRef.current = null; };
  }, [arrivalRef]);

  const visit = useCallback(async (stopId: string, name: string) => {
    setBusy(true);
    state.current = resolveArrival(state.current, stopId, "confirmed", Date.now());
    setPrompt(null); setUnsure(null); setNear(null);
    // The destination is decided per drive (it shares one id across drives): "Finish" is never remembered, so the next drive can finish too.
    if (stopsRef.current.find((s) => s.id === stopId)?.kind === "destination") { setBusy(false); cb.current.onFinish?.(); return; }
    persist();
    const earlier = earlierUnvisited(stopsRef.current, stopId).map((s) => ({ id: s.id, name: s.name }));
    const result = await markRef.current(stopId, "done", name);
    setDone({ stopId, name, queued: result === "queued", earlier });
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads the memory key and the state ref
  }, [memoryKey]);

  const confirm = useCallback(() => { if (prompt) void visit(prompt.stopId, prompt.name); }, [prompt, visit]);
  const dismiss = useCallback(() => {
    if (!prompt) return;
    state.current = resolveArrival(state.current, prompt.stopId, "dismissed", Date.now());
    if (!prompt.destination) persist();
    setPrompt(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads the memory key and the state ref
  }, [prompt, memoryKey]);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads the memory key and the state ref
  }, [done, memoryKey]);
  const skipEarlier = useCallback(async () => {
    if (!done || done.earlier.length === 0) return;
    const list = done.earlier;
    setDone((d) => (d ? { ...d, earlier: [] } : d));
    for (const e of list) await markRef.current(e.id, "skipped", e.name);
  }, [done]);
  const keepEarlier = useCallback(() => setDone((d) => (d ? { ...d, earlier: [] } : d)), []);
  const closeDone = useCallback(() => setDone(null), []);

  // Only for a stop that still exists and is still to be visited: never "you've arrived" at a deleted stop.
  const open = (id: string) => stops.some((s) => s.id === id && s.status === "planned");
  const doneView = done && stops.some((s) => s.id === done.stopId) ? { ...done, earlier: done.earlier.filter((e) => stops.some((s) => s.id === e.id)) } : null;
  const promptView = enabled && prompt && prompt.session === session && open(prompt.stopId) ? prompt : null;
  return {
    prompt: promptView,
    unsure: enabled && unsure && unsure.session === session && open(unsure.stopId) ? unsure : null,
    approach: enabled && !promptView && near && near.session === session && (targetId === undefined || near.stopId === targetId) && open(near.stopId) ? near : null,
    done: doneView, busy, confirm, dismiss, confirmUnsure, dismissUnsure, undo, skipEarlier, keepEarlier, closeDone,
  };
}

export type Arrival = ReturnType<typeof useArrival>;

/** Navigation already says "You have arrived" (end of the line): an old "Arriving in … m" next to it would contradict it. */
export function withoutStaleApproach<T extends { approach: ApproachView | null }>(arrival: T, navPhase: string): T {
  return navPhase === "arrived" && arrival.approach ? { ...arrival, approach: null } : arrival;
}
