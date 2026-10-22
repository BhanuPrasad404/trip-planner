"use client";

// The live "will it fit?" meter. Road times are fetched ONCE per set of places (start + places, after a short pause, remembered for the
// page); every answer change after that is recomputed on the phone with the real engine, instantly and at no cost.
import { useEffect, useMemo, useRef, useState } from "react";
import { fitMeter, type Matrix, type Meter, type MeterPlace } from "@/lib/intake/fit-meter";
import type { TripAnswers } from "@/lib/intake/types";

export const ROADS_PAUSE_MS = 500;
const roads = new Map<string, Matrix>();
export const clearFitMeterMemory = () => roads.clear();
const keyOf = (start: { lat: number; lng: number } | null, places: MeterPlace[]) =>
  start ? [start, ...places].map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|") : "";

export type RoadsState = "idle" | "loading" | "ready" | "error";

export function useFitMeter(args: { answers: TripAnswers; start: { lat: number; lng: number; name: string } | null; places: MeterPlace[]; startDateISO?: string | null; online?: boolean }): { meter: Meter; roads: RoadsState; error: string | null } {
  const { answers, start, places, startDateISO = null, online = true } = args;
  const key = keyOf(start, places);
  const [state, setState] = useState<{ key: string; status: RoadsState; error: string | null }>({ key: "", status: "idle", error: null });
  const [, force] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  const pointsRef = useRef<{ lat: number; lng: number }[]>([]);
  useEffect(() => { pointsRef.current = start ? [start, ...places].map((p) => ({ lat: p.lat, lng: p.lng })) : []; });

  useEffect(() => {
    if (!key || places.length === 0 || roads.has(key) || !online) return;
    const t = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setState({ key, status: "loading", error: null });
      fetch("/api/intake/roads", { method: "POST", headers: { "Content-Type": "application/json" }, signal: c.signal, body: JSON.stringify({ points: pointsRef.current }) })
        .then(async (r) => {
          const b = (await r.json().catch(() => null)) as (Matrix & { error?: string }) | null;
          if (!r.ok || !b || !Array.isArray(b.durations)) throw new Error(b?.error ?? "Couldn't check the roads right now.");
          roads.set(key, b);
          setState({ key, status: "ready", error: null });
          force((n) => n + 1);
        })
        .catch((e) => { if (!c.signal.aborted) setState({ key, status: "error", error: e instanceof Error ? e.message : "Couldn't check the roads right now." }); });
    }, ROADS_PAUSE_MS);
    return () => clearTimeout(t);
  }, [key, places.length, online]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const matrix = roads.get(key) ?? null;
  const meter = useMemo(() => fitMeter({ answers, start, places, matrix, startDateISO }), [answers, start, places, matrix, startDateISO]);
  const status: RoadsState = matrix ? "ready" : state.key === key ? state.status : "idle";
  if (!matrix && status === "error") return { meter: { ...meter, headline: "Couldn't check the roads right now", detail: state.error ?? "" }, roads: status, error: state.error };
  if (!matrix && !online && places.length && start) return { meter: { ...meter, headline: "You're offline", detail: "The fit check needs the internet for road times." }, roads: "idle", error: null };
  return { meter, roads: status, error: null };
}
