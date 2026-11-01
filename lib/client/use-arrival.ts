"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Me } from "@/lib/client/use-drive";
import type { VisitStatus } from "@/lib/client/visit-queue";
import { earlierUnvisited, initialArrival, resolveArrival, restoreHandled, serializeHandled, stepArrival, zoneFor, type ArrivalState, type ArrivalStop } from "@/lib/trip/arrival";

/** Per PERSON and trip: on a shared phone, one person's answers never silence or prompt the next person. */
export const arrivalMemoryKey = (userId: string, tripId: string) => `tm:arrival:${userId}:${tripId}`;
/** Above this a question is held until the traveller has slowed; below STOPPED it is shown again (between the two: as it was). */
export const MOVING_KMH = 15;
export const STOPPED_KMH = 8;
const readHandled = (key: string) => { try { return restoreHandled(window.localStorage.getItem(key), Date.now()); } catch { return {}; } };

export type ArrivalPromptView = { session: number; stopId: string; name: string; distanceM: number; accuracyM: number; area: boolean; destination: boolean };
export type ArrivalUnsureView = { session: number; stopId: string; name: string; distanceM: number; accuracyM: number | null };
/** `arrived`: the traveller said they reached it (nothing is marked visited). `done`: they then marked it visited. */
export type ArrivalDoneView = { stopId: string; name: string; queued: boolean; earlier: { id: string; name: string }[]; stage: "arrived" | "done"; /** When they said they arrived (ms), for "Arrived 2:07 AM". */ arrivedAt: number };
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
  mark: (placeId: string, status: VisitStatus, name?: string, expected?: VisitStatus) => Promise<"saved" | "queued">;
  /** "I've arrived" / "not here yet": recorded with the time it was said. Never marks the stop visited. Absent: arrival is only remembered on this phone. */
  arrive?: (placeId: string, arrived: boolean, name?: string, evidence?: { source: "gps" | "manual"; accuracyM?: number }) => Promise<"saved" | "queued">;
  /** Notes what the traveller said about a place that is not a change of status: "just passing through", "I'm exploring". Saved to the journey's history. */
  note?: (kind: "passed_through" | "exploring_started", stop: { id: string; name: string }) => void;
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
export function useArrival({ tripId, userId, stops, targetId, enabled, session, arrivalRef, mark, arrive, note, onApproach, onPrompt, onFinish }: Args) {
  const memoryKey = arrivalMemoryKey(userId, tripId);
  const state = useRef<ArrivalState>(initialArrival());
  const stopsRef = useRef(stops);
  const enabledRef = useRef(enabled);
  const markRef = useRef(mark);
  const arriveRef = useRef(arrive);
  const noteRef = useRef(note);
  const targetRef = useRef(targetId);
  const cb = useRef({ onApproach, onPrompt, onFinish });
  const sessionRef = useRef(session);
  const mutedUnsure = useRef<Set<string>>(new Set());
  const [prompt, setPrompt] = useState<ArrivalPromptView | null>(null);
  const [unsure, setUnsure] = useState<ArrivalUnsureView | null>(null);
  const [done, setDone] = useState<ArrivalDoneView | null>(null);
  const [near, setNear] = useState<ApproachView | null>(null);
  const [busy, setBusy] = useState(false);
  // Moving at driving speed: a question is held (kept, not lost) until the traveller has slowed down. Hysteresis, so it does not flicker.
  const [moving, setMoving] = useState(false);
  useEffect(() => { stopsRef.current = stops; enabledRef.current = enabled; markRef.current = mark; arriveRef.current = arrive; noteRef.current = note; targetRef.current = targetId; cb.current = { onApproach, onPrompt, onFinish }; sessionRef.current = session; });

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
      if (m.speedKmh !== null && Number.isFinite(m.speedKmh)) setMoving((was) => (m.speedKmh! > MOVING_KMH ? true : m.speedKmh! < STOPPED_KMH ? false : was));
      const r = stepArrival(state.current, { lat: m.lat, lng: m.lng, accuracyM: m.accuracyM, speedKmh: m.speedKmh, fixAt: m.fixAt, manual: m.manual }, stopsRef.current, Date.now(), targetRef.current === undefined ? {} : { targetId: targetRef.current });
      state.current = r.state;
      const named = (id: string) => stopsRef.current.find((s) => s.id === id);
      // "Arriving in … m" follows the engine's hysteresis; the distance is rounded to 10 m so the screen does not churn.
      const n = r.state.near ? named(r.state.near.stopId) : null;
      const nextNear = n && r.state.near ? { session: sessionRef.current, stopId: n.id, name: n.name, distanceM: Math.max(10, Math.round(r.state.near.distanceM / 10) * 10), area: zoneFor(n.category, n.role).area } : null;
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

  /**
   * "I've arrived." Recorded with the time it was said; the stop is NOT marked visited (that is a separate choice on the card that
   * follows, or later in the list). The destination ends the drive and is never "marked".
   */
  const visit = useCallback(async (stopId: string, name: string, evidence?: { source: "gps" | "manual"; accuracyM?: number }) => {
    setBusy(true);
    state.current = resolveArrival(state.current, stopId, "confirmed", Date.now());
    setPrompt(null); setUnsure(null); setNear(null);
    // The destination is decided per drive (it shares one id across drives): "Finish" is never remembered, so the next drive can finish too.
    if (stopsRef.current.find((s) => s.id === stopId)?.kind === "destination") { setBusy(false); cb.current.onFinish?.(); return; }
    persist();
    const earlier = earlierUnvisited(stopsRef.current, stopId).map((s) => ({ id: s.id, name: s.name }));
    const arrivedAt = Date.now();
    const result = arriveRef.current ? await arriveRef.current(stopId, true, name, evidence) : "saved";
    setDone({ stopId, name, queued: result === "queued", earlier, stage: "arrived", arrivedAt });
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads the memory key and the state ref
  }, [memoryKey]);

  /** "Mark visited", a separate choice after arriving. */
  const complete = useCallback(async () => {
    if (!done || done.stage !== "arrived") return;
    const d = done;
    setBusy(true);
    const result = await markRef.current(d.stopId, "done", d.name, "planned");
    setDone({ ...d, queued: result === "queued", stage: "done" });
    setBusy(false);
  }, [done]);

  // The phone noticed the arrival (a precise reading, a real stay) and the traveller agreed: that is a location-backed arrival. From the
  // "you may be near" card the reading was too vague to count, so it is the traveller's word alone.
  const confirm = useCallback(() => { if (prompt) void visit(prompt.stopId, prompt.name, { source: "gps", accuracyM: prompt.accuracyM }); }, [prompt, visit]);
  /** "Just passing through": nothing was visited and nothing is recorded as arrived; we do not ask about this place again. */
  const passing = useCallback(() => {
    if (!prompt || prompt.destination) return;
    state.current = resolveArrival(state.current, prompt.stopId, "passing", Date.now());
    persist();
    noteRef.current?.("passed_through", { id: prompt.stopId, name: prompt.name });
    setPrompt(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads the memory key and the state ref
  }, [prompt, memoryKey]);
  /** After arriving: "I'm exploring". Noted in the history; the stop stays as it is (arrived, not visited) and the card goes away. */
  const explore = useCallback(() => {
    if (!done || done.stage !== "arrived") return;
    noteRef.current?.("exploring_started", { id: done.stopId, name: done.name });
    setDone(null);
  }, [done]);
  const dismiss = useCallback(() => {
    if (!prompt) return;
    state.current = resolveArrival(state.current, prompt.stopId, "dismissed", Date.now());
    if (!prompt.destination) persist();
    setPrompt(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads the memory key and the state ref
  }, [prompt, memoryKey]);
  const confirmUnsure = useCallback(() => { if (unsure) void visit(unsure.stopId, unsure.name, { source: "manual" }); }, [unsure, visit]);
  const dismissUnsure = useCallback(() => { if (unsure) { mutedUnsure.current.add(unsure.stopId); setUnsure(null); } }, [unsure]);

  /** Arrived: "not here yet" clears the arrival. Visited: back to planned (the arrival stays). Either way, no new question until the traveller leaves and returns. */
  const undo = useCallback(async () => {
    if (!done) return;
    state.current = resolveArrival(state.current, done.stopId, "dismissed", Date.now());
    persist();
    const d = done;
    setDone(null);
    if (d.stage === "arrived") await arriveRef.current?.(d.stopId, false, d.name);
    else await markRef.current(d.stopId, "planned", d.name, "done");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only reads the memory key and the state ref
  }, [done, memoryKey]);
  const skipEarlier = useCallback(async () => {
    if (!done || done.earlier.length === 0) return;
    const list = done.earlier;
    setDone((d) => (d ? { ...d, earlier: [] } : d));
    for (const e of list) await markRef.current(e.id, "skipped", e.name, "planned");
  }, [done]);
  const keepEarlier = useCallback(() => setDone((d) => (d ? { ...d, earlier: [] } : d)), []);
  const closeDone = useCallback(() => setDone(null), []);

  // Only for a stop that still exists and is still to be visited: never "you've arrived" at a deleted stop.
  const open = (id: string) => stops.some((s) => s.id === id && s.status === "planned");
  const doneView = done && stops.some((s) => s.id === done.stopId) ? { ...done, earlier: done.earlier.filter((e) => stops.some((s) => s.id === e.id)) } : null;
  const promptView = enabled && !moving && prompt && prompt.session === session && open(prompt.stopId) ? prompt : null;
  return {
    prompt: promptView,
    unsure: enabled && !moving && unsure && unsure.session === session && open(unsure.stopId) ? unsure : null,
    approach: enabled && !promptView && near && near.session === session && (targetId === undefined || near.stopId === targetId) && open(near.stopId) ? near : null,
    done: doneView, busy, moving, confirm, complete, passing, explore, dismiss, confirmUnsure, dismissUnsure, undo, skipEarlier, keepEarlier, closeDone,
  };
}

export type Arrival = ReturnType<typeof useArrival>;

/** Navigation already says "You have arrived" (end of the line): an old "Arriving in … m" next to it would contradict it. */
export function withoutStaleApproach<T extends { approach: ApproachView | null }>(arrival: T, navPhase: string): T {
  return navPhase === "arrived" && arrival.approach ? { ...arrival, approach: null } : arrival;
}
