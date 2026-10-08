"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PoiPhoto } from "@/lib/intel/poi-media";
import { distanceKm } from "@/lib/geo";
import type { IntelResult } from "@/lib/intel/types";
import type { RouteLeg } from "@/lib/providers/types";

export type IntelStopInput = {
  id: string; name: string; lat: number; lng: number; plannedArrival: string | null;
  visitMin: number; value: number; valueNote: string | null; outdoor: boolean;
};

export type IntelState = {
  result: IntelResult | null;
  coverage: { total: number; ready: number; pending: number; failed: number } | null;
  /** Each place's OWN photo (never a nearby traveler's upload), keyed by place key. */
  photos: Record<string, PoiPhoto>;
  /** Where the advice is computed from. */
  mode: "live" | "preview" | "idle";
  busy: boolean;
  error: string | null;
  notes: string[];
  updatedAt: number | null;
  refresh: () => void;
};

type Origin = { lat: number; lng: number; heading: number | null; speedKmh: number | null };

const POLL_MS = 15_000; // how often we CHECK whether it's time to ask again
const LIVE_REFRESH_MS = 120_000;
const MIN_GAP_MS = 20_000;
const MOVE_KM = 3;
const RETRY_WHILE_MAPPING_MS = 12_000;

const decimate = (line: [number, number][], max: number) => {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
};

/**
 * Keeps Trip Intelligence fresh. Live from the device while driving; otherwise a PREVIEW from a planned starting point,
 * so you can see the same advice while planning. It asks the server again only when it matters:
 * you moved ~3 km, a couple of minutes passed, your stops changed, or the map data was still being built.
 */
export function useIntel(args: {
  tripId: string;
  enabled: boolean;
  live: Origin | null;
  preview: Origin | null;
  stops: IntelStopInput[];
  /** The road Drive mode already has (saves a routing call). */
  route: { legs: RouteLeg[]; line: [number, number][]; stopIds: string[] } | null;
  comparePlan: boolean;
  dayEndMin?: number;
  drivingMin?: number | null;
  canMoveNextDay?: boolean;
}): IntelState {
  const { tripId, enabled } = args;
  const [state, setState] = useState<Omit<IntelState, "refresh">>({ result: null, coverage: null, photos: {}, mode: "idle", busy: false, error: null, notes: [], updatedAt: null });

  const latest = useRef(args);
  const last = useRef<{ lat: number; lng: number; at: number; key: string; mode: string } | null>(null);
  const busy = useRef(false);
  const retryAt = useRef(0);
  const force = useRef(false);
  useEffect(() => {
    latest.current = args;
  });

  const run = useCallback(async () => {
    const a = latest.current;
    const origin = a.live ?? a.preview;
    if (!origin || busy.current) return;
    const mode = a.live ? "live" : "preview";
    busy.current = true;
    setState((s) => ({ ...s, busy: true, mode }));
    try {
      const stopIds = a.stops.map((s) => s.id);
      const routeOk = a.route && a.route.legs.length === a.stops.length && a.route.stopIds.join() === stopIds.join();
      const res = await fetch("/api/intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          position: { lat: origin.lat, lng: origin.lng },
          heading: a.live ? origin.heading : null,
          speed_kmh: a.live ? origin.speedKmh : null,
          utc_offset_min: -new Date().getTimezoneOffset(),
          day_end_min: a.dayEndMin ?? 20 * 60,
          compare_plan: a.comparePlan && !!a.live,
          driving_min: a.live ? a.drivingMin ?? null : null,
          can_move_next_day: a.canMoveNextDay ?? false,
          stops: a.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, planned_arrival: s.plannedArrival, visit_min: s.visitMin, value: s.value, value_note: s.valueNote, outdoor: s.outdoor })),
          route: routeOk ? { line: decimate(a.route!.line, 400), legs: a.route!.legs } : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't get suggestions right now.");
      last.current = { lat: origin.lat, lng: origin.lng, at: Date.now(), key: stopIds.join(), mode };
      const mapping = body.coverage && body.coverage.ready < body.coverage.total && body.coverage.failed === 0;
      retryAt.current = mapping ? Date.now() + RETRY_WHILE_MAPPING_MS : 0;
      setState({
        result: body.result ?? null, coverage: body.coverage ?? null, photos: body.photos ?? {}, mode, busy: false,
        error: null, notes: body.notes ?? [], updatedAt: Date.now(),
      });
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : "Couldn't get suggestions right now." }));
    } finally {
      busy.current = false;
    }
  }, [tripId]);

  // Decide, every few seconds, whether it's time to ask again.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const a = latest.current;
      const origin = a.live ?? a.preview;
      if (!origin) return;
      const l = last.current;
      const now = Date.now();
      const mode = a.live ? "live" : "preview";
      const key = a.stops.map((s) => s.id).join();
      const sameContext = !!l && l.key === key && l.mode === mode;
      const movedFar = !!l && distanceKm(l, origin) >= MOVE_KM;
      const old = !!l && now - l.at >= LIVE_REFRESH_MS;
      const mappingRetry = retryAt.current > 0 && now >= retryAt.current;
      const due = force.current || !sameContext || mappingRetry || (mode === "live" && (movedFar || old));
      if (!due) return;
      if (l && !force.current && now - l.at < MIN_GAP_MS) return; // never more often than every 20 s
      force.current = false;
      void run();
    };
    const first = setTimeout(tick, 300);
    const timer = setInterval(tick, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, run]);

  const refresh = useCallback(() => {
    force.current = true;
    void run();
  }, [run]);

  return { ...state, refresh };
}
