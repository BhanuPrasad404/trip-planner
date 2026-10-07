"use client";

// Live navigation. "Drive now" ARMS it: as soon as the drive is confirmed and your position is precise, the road route from
// where you really are to the next stop is fetched and followed — no extra button. Every GPS fix then updates progress,
// the next maneuver, remaining distance and ETA, and checks for a genuine wrong turn. Routing is requested only when
// something meaningful happens (start, wrong turn, next stop); older answers can never overwrite newer ones.
// The maths is in lib/map/navigation.ts (pure, tested); this file is the state machine around it.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { OFF_ROUTE, bannerFor, cameraBearing, checkOffRoute, indexRoute, initialOffRoute, isGpsJump, progressOn, type Banner, type NavIndex, type NavProgress, type OffRouteState } from "@/lib/map/navigation";
import { describeRoutes, type RouteChoice } from "@/lib/map/directions";
import { haversineM } from "@/lib/geo";
import type { NavRoute } from "@/lib/providers/types";
import type { Me } from "./use-drive";

export type NavPhase = "idle" | "loading" | "choosing" | "navigating" | "arrived" | "error";
export type NavTarget = { id: string; name: string; lat: number; lng: number };
/** Where to draw the "you" puck: snapped to the road when you are on it, at the raw GPS position when you are not. */
export type Puck = {
  lat: number; lng: number; bearing: number | null; onRoute: boolean;
  /** True only when the direction is trustworthy (you are moving). When false the heading cone is hidden and the map keeps its orientation. */
  headingKnown: boolean;
};

type State = {
  forTargetId: string | null;
  phase: NavPhase;
  routes: NavRoute[];
  choices: RouteChoice[];
  selectedId: string | null;
  progress: NavProgress | null;
  banner: Banner | null;
  puck: Puck | null;
  rerouting: boolean;
  offRouteSuspected: boolean;
  uncertain: boolean;
  notice: string | null;
  error: string | null;
  notes: string[];
  /** Other routes from where you were when you asked. Choosing one switches the ACTIVE route; ignoring them changes nothing. */
  alternatives: NavRoute[];
  altChoices: RouteChoice[];
  altLoading: boolean;
  /** Where you were when the alternatives were measured. */
  altFrom: { lat: number; lng: number } | null;
};
const EMPTY: State = { forTargetId: null, phase: "idle", routes: [], choices: [], selectedId: null, progress: null, banner: null, puck: null, rerouting: false, offRouteSuspected: false, uncertain: false, notice: null, error: null, notes: [], alternatives: [], altChoices: [], altLoading: false, altFrom: null };

export type Navigation = Omit<State, "forTargetId"> & {
  target: NavTarget | null;
  voice: boolean;
  /** Armed = "Drive now" was pressed: routes start by themselves when the position is precise, and for each next stop. */
  armed: boolean;
  arm: () => void;
  /** Ask for other routes from where you are now WITHOUT interrupting the drive. */
  routeOptions: () => void;
  closeOptions: () => void;
  choose: (id: string) => void;
  begin: () => void;
  /** Stop navigating (and stop auto-starting). */
  stop: () => void;
  retry: () => void;
  toggleVoice: () => void;
  dismissNotice: () => void;
};

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // never queue stale instructions
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-IN";
  window.speechSynthesis.speak(u);
}

class RoutingUnavailable extends Error {}

async function fetchDirections(from: { lat: number; lng: number }, to: { lat: number; lng: number }, alternatives: number, signal: AbortSignal) {
  const res = await fetch("/api/directions", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, alternatives }) });
  const body = (await res.json().catch(() => null)) as { routes?: NavRoute[]; choices?: RouteChoice[]; notes?: string[]; error?: string } | null;
  if (!res.ok || !body?.routes?.length) throw new Error(body?.error ?? "Couldn't get directions right now.");
  // A straight line is NOT a route. If the routing service could not answer, say so instead of drawing one.
  if (body.routes[0].source === "estimate") throw new RoutingUnavailable("Road directions are unavailable right now, so we can't show a route yet. We'll keep trying.");
  return { routes: body.routes, choices: body.choices ?? [], notes: body.notes ?? [] };
}

const RETRY_AFTER_MS = 15_000;

export function useNavigation(args: { target: NavTarget | null; ready: boolean; fixRef: MutableRefObject<((m: Me) => void) | null>; onArrive?: (t: NavTarget) => void }): Navigation {
  const { target, ready, fixRef } = args;
  const [s, setS] = useState<State>(EMPTY);
  const [voice, setVoice] = useState(true);
  const [armed, setArmed] = useState(false);

  const targetRef = useRef(target);
  const onArriveRef = useRef(args.onArrive);
  const voiceRef = useRef(voice);
  const readyRef = useRef(ready);
  const armedRef = useRef(false);
  const phaseRef = useRef<NavPhase>("idle");
  const forTargetRef = useRef<string | null>(null);
  const navRef = useRef<NavIndex | null>(null);
  const offRef = useRef<OffRouteState>(initialOffRoute());
  const lastFix = useRef<Me | null>(null);
  const acceptedFix = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const jumpStrikes = useRef(0);
  const lastSpoken = useRef<string | null>(null);
  const reqId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const altReq = useRef(0);
  const altAbort = useRef<AbortController | null>(null);
  const busyRef = useRef(false); // a routing request is in flight
  const errorAt = useRef(0);
  const lastBearing = useRef(0);
  useEffect(() => {
    targetRef.current = target;
    onArriveRef.current = args.onArrive;
    voiceRef.current = voice;
    readyRef.current = ready;
  });

  const patch = useCallback((p: Partial<State>) => setS((cur) => ({ ...cur, ...p })), []);
  const setPhase = useCallback((phase: NavPhase, extra: Partial<State> = {}) => {
    phaseRef.current = phase;
    forTargetRef.current = targetRef.current?.id ?? null;
    if (phase === "error") errorAt.current = Date.now();
    setS((cur) => ({ ...cur, phase, forTargetId: forTargetRef.current, ...extra }));
  }, []);

  /** Cancel whatever routing request is running; its answer must not be used. */
  const cancelRequest = useCallback(() => {
    reqId.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    altReq.current++;
    altAbort.current?.abort();
    altAbort.current = null;
    busyRef.current = false;
  }, []);

  const startRoute = useCallback((route: NavRoute, choices: RouteChoice[], notes: string[]) => {
    navRef.current = indexRoute(route);
    offRef.current = initialOffRoute();
    lastSpoken.current = null;
    phaseRef.current = "navigating";
    forTargetRef.current = targetRef.current?.id ?? null;
    if (voiceRef.current) speak(route.steps[0]?.instruction ?? "Starting navigation");
    setS((cur) => ({ ...cur, phase: "navigating", forTargetId: forTargetRef.current, routes: [route], choices: choices.filter((c) => c.id === route.id), selectedId: route.id, notes, notice: null, error: null, rerouting: false, offRouteSuspected: false, alternatives: [], altChoices: [], altLoading: false, altFrom: null }));
  }, []);

  /** Ask for routes from where you REALLY are to the next stop. `auto`: start the fastest one straight away. */
  const load = useCallback((auto: boolean) => {
    const t = targetRef.current, here = lastFix.current;
    if (!t || !here || !readyRef.current || busyRef.current) return;
    cancelRequest();
    const id = reqId.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    busyRef.current = true;
    setPhase("loading", { error: null, notice: null, progress: null, banner: null, puck: null, routes: [], choices: [] });
    // Starting by itself needs only the fastest road (one cheap request); the alternatives come with "Other routes".
    fetchDirections(here, t, auto ? 0 : 2, ctrl.signal).then((r) => {
      if (id !== reqId.current) return; // a newer request (or a stop) replaced this one
      busyRef.current = false;
      if (auto) {
        startRoute(r.routes[0], r.choices, r.notes);
        // Show distance/ETA at once, even if no further GPS reading arrives (e.g. a start point the traveller chose).
        queueMicrotask(() => { const f = lastFix.current; if (f) fixRef.current?.(f); });
      }
      else setPhase("choosing", { routes: r.routes, choices: r.choices, selectedId: r.routes[0].id, notes: r.notes });
    }).catch((e: unknown) => {
      if (id !== reqId.current || (e instanceof DOMException && e.name === "AbortError")) return;
      busyRef.current = false;
      setPhase("error", { error: e instanceof Error ? e.message : "Couldn't get directions right now." });
    });
  }, [cancelRequest, fixRef, setPhase, startRoute]);

  const reroute = useCallback(async (m: Me) => {
    const t = targetRef.current;
    if (!t || busyRef.current) return; // never stack a second request on a running one
    cancelRequest();
    const id = reqId.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    busyRef.current = true;
    patch({ rerouting: true });
    if (voiceRef.current) speak("Rerouting");
    try {
      const r = await fetchDirections(m, t, 0, ctrl.signal);
      if (id !== reqId.current || phaseRef.current !== "navigating") return; // stale: a newer request or a stop happened meanwhile
      const route = r.routes[0];
      navRef.current = indexRoute(route);
      offRef.current = { ...initialOffRoute(), lastRerouteAt: m.at };
      lastSpoken.current = null;
      patch({ routes: [route], selectedId: route.id, rerouting: false, offRouteSuspected: false, notice: "Route updated", notes: r.notes });
    } catch (e) {
      if (id !== reqId.current || (e instanceof DOMException && e.name === "AbortError")) return;
      patch({ rerouting: false, notice: "Couldn't find a new route yet — keeping the old line. We'll try again." });
    } finally {
      if (id === reqId.current) busyRef.current = false;
    }
  }, [cancelRequest, patch]);

  // Every GPS fix.
  const onFix = useCallback((m: Me) => {
    lastFix.current = m;

    // The next stop changed (you finished one): the old route no longer applies.
    if (forTargetRef.current !== (targetRef.current?.id ?? null) && phaseRef.current !== "idle") {
      cancelRequest();
      navRef.current = null;
      phaseRef.current = "idle";
    }

    // One implausible jump (e.g. a network position replacing a satellite fix) is ignored; if the new place persists it is accepted.
    if (isGpsJump(acceptedFix.current, m) && ++jumpStrikes.current < 2) return;
    jumpStrikes.current = 0;
    acceptedFix.current = { lat: m.lat, lng: m.lng, at: m.at };

    // Drive now → route, by itself.
    if (armedRef.current && readyRef.current && targetRef.current) {
      if (phaseRef.current === "idle") { load(true); return; }
      if (phaseRef.current === "error" && Date.now() - errorAt.current >= RETRY_AFTER_MS) { load(true); return; } // a temporary routing outage heals itself
    }

    const nav = navRef.current;
    if (!nav || phaseRef.current !== "navigating") return;
    // A reading this vague (usually a network position) says nothing reliable about where you are on the road:
    // keep the last good progress, tell the traveller, and do NOT guess, jump the puck or re-route.
    if (m.accuracyM === null || m.accuracyM > OFF_ROUTE.blindAboveAccuracyM) { patch({ uncertain: true }); return; }

    const p = progressOn(nav, m, m.at);
    const verdict = checkOffRoute(offRef.current, { offsetM: p.offsetM, accuracyM: m.accuracyM, nowMs: m.at });
    offRef.current = verdict.state;
    const onRoute = p.offsetM <= verdict.thresholdM;
    const bearing = cameraBearing({ speedKmh: m.speedKmh, routeBearing: onRoute ? p.routeBearing : (m.heading ?? null), deviceHeading: m.heading, previous: lastBearing.current });
    lastBearing.current = bearing;
    const headingKnown = (m.speedKmh ?? 0) >= 3 && (onRoute || m.heading !== null);
    const banner = bannerFor(p, m.speedKmh);
    patch({ progress: p, banner, uncertain: false, offRouteSuspected: verdict.state.strikes >= 2, puck: { lat: onRoute ? p.snapped.lat : m.lat, lng: onRoute ? p.snapped.lng : m.lng, bearing, onRoute, headingKnown } });

    if (p.arrived) {
      setPhase("arrived", { progress: p, banner, rerouting: false });
      if (voiceRef.current) speak("You have arrived at your destination");
      if (targetRef.current) onArriveRef.current?.(targetRef.current);
      return;
    }
    if (voiceRef.current && banner.announceKey && banner.announceKey !== lastSpoken.current) {
      lastSpoken.current = banner.announceKey;
      speak(banner.spoken);
    }
    if (verdict.reroute) void reroute(m);
  }, [cancelRequest, load, patch, reroute, setPhase]);

  useEffect(() => {
    fixRef.current = onFix;
    return () => { fixRef.current = null; };
  }, [fixRef, onFix]);
  useEffect(() => () => cancelRequest(), [cancelRequest]);

  // Drive now → route. Triggered when things BECOME ready (drive confirmed, position usable, next stop) — not only when a new
  // GPS reading arrives. A start point the traveller picks produces no further readings, which used to leave it stuck on "finding route".
  const targetId = target?.id ?? null;
  useEffect(() => {
    if (!armed || !ready || !targetId) return;
    const timer = setTimeout(() => {
      if (!lastFix.current) return;
      const stale = forTargetRef.current !== targetId && phaseRef.current !== "idle";
      if (stale) { cancelRequest(); navRef.current = null; phaseRef.current = "idle"; }
      if (phaseRef.current === "idle") load(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [armed, ready, targetId, load, cancelRequest]);

  const arm = useCallback(() => { armedRef.current = true; setArmed(true); }, []);
  const sRef = useRef(s);
  useEffect(() => { sRef.current = s; });

  /** Make `route` THE active route, atomically: line, progress, distance, ETA and off-route detection all follow it. */
  const switchTo = useCallback((route: NavRoute) => {
    cancelRequest(); // a reroute or option request still in flight belongs to the OLD route
    navRef.current = indexRoute(route);
    offRef.current = initialOffRoute();
    lastSpoken.current = null;
    if (voiceRef.current) speak("Route changed");
    setS((cur) => ({ ...cur, routes: [route], selectedId: route.id, choices: [], alternatives: [], altChoices: [], altLoading: false, altFrom: null, rerouting: false, offRouteSuspected: false, notice: `Now following ${route.via || "the new route"}` }));
    queueMicrotask(() => { const f = lastFix.current; if (f) fixRef.current?.(f); }); // distance and ETA at once, no waiting for the next reading
  }, [cancelRequest, fixRef]);

  const loadAlternatives = useCallback((refreshed: boolean) => {
    const t = targetRef.current, here = lastFix.current;
    if (!t || !here) return;
    if (phaseRef.current !== "navigating") { busyRef.current = false; load(false); return; } // not navigating yet: the full chooser
    const id = ++altReq.current;
    altAbort.current?.abort();
    const ctrl = new AbortController();
    altAbort.current = ctrl;
    patch({ altLoading: true });
    fetchDirections(here, t, 2, ctrl.signal).then((r) => {
      if (id !== altReq.current || phaseRef.current !== "navigating") return; // stale: you switched, rerouted or stopped meanwhile
      const current = navRef.current?.route;
      // Drop the answer that is just the road you are already on.
      const alts = r.routes
        .map((rt, i) => ({ ...rt, id: `alt${id}-${i}` }))
        .filter((rt) => !current || !(Math.abs(rt.distanceM - current.distanceM) / current.distanceM < 0.01 && rt.via === current.via));
      patch({ alternatives: alts, altChoices: describeRoutes(current ? [current, ...alts] : alts), altLoading: false, altFrom: { lat: here.lat, lng: here.lng }, notice: alts.length === 0 ? "No other sensible route found — you're on the best one." : refreshed ? "Updated from your current position — choose again." : null });
    }).catch((e: unknown) => {
      if (id !== altReq.current || (e instanceof DOMException && e.name === "AbortError")) return;
      patch({ altLoading: false, notice: "Couldn't load other routes right now — you're still on your current route." });
    });
  }, [load, patch]);
  const routeOptions = useCallback(() => loadAlternatives(false), [loadAlternatives]);

  const closeOptions = useCallback(() => { altReq.current++; altAbort.current?.abort(); patch({ alternatives: [], altChoices: [], altLoading: false, altFrom: null }); }, [patch]);

  const choose = useCallback((id: string) => {
    if (phaseRef.current !== "navigating") { patch({ selectedId: id }); return; } // the chooser before navigation starts
    const cur = sRef.current;
    const alt = cur.alternatives.find((r) => r.id === id);
    if (!alt) return; // tapping the route you are already on changes nothing
    const here = lastFix.current;
    if (here && cur.altFrom && haversineM(here, cur.altFrom) > 1_000) {
      // These were measured from where you WERE: re-measure instead of switching to a line that starts behind you.
      patch({ alternatives: [], altChoices: [], notice: "Those routes were measured a while ago — refreshing them." });
      loadAlternatives(true);
      return;
    }
    switchTo(alt);
  }, [patch, loadAlternatives, switchTo]);

  const begin = useCallback(() => {
    const cur = sRef.current;
    const route = cur.routes.find((r) => r.id === cur.selectedId) ?? cur.routes[0];
    if (!route) return;
    startRoute(route, cur.choices, cur.notes);
    queueMicrotask(() => { const f = lastFix.current; if (f) fixRef.current?.(f); });
  }, [fixRef, startRoute]);

  const stop = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
    cancelRequest();
    navRef.current = null;
    forTargetRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    phaseRef.current = "idle";
    setS(EMPTY);
  }, [cancelRequest]);

  const retry = useCallback(() => { busyRef.current = false; load(armedRef.current); }, [load]);
  const toggleVoice = useCallback(() => {
    setVoice((v) => {
      if (v && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      return !v;
    });
  }, []);

  // A different target (you finished a stop) means the old directions no longer apply.
  const stale = s.forTargetId !== (target?.id ?? null) && s.phase !== "idle";
  const view: State = stale ? EMPTY : s;
  const { forTargetId: _unused, ...rest } = view;
  void _unused;
  return { ...rest, target, voice, armed, arm, routeOptions, closeOptions, choose, begin, stop, retry, toggleVoice, dismissNotice: () => patch({ notice: null }) };
}
