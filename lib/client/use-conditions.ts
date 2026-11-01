"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";
import type { ConditionItem } from "@/lib/trip/conditions";

export type ConditionsReport = { items: ConditionItem[]; unresolved: string[]; limitations: string[]; asOf: number; hasDates: boolean };
/** How the traveller said the tank is (never guessed): a percentage or not said. Kept on this phone only. */
export const fuelKey = (tripId: string) => `tm:fuel:${tripId}`;
export const REFRESH_MS = 30 * 60_000;
const EMPTY_FUEL: { pct?: number | null } = {};

type Args = { tripId: string; enabled: boolean; localDate: string | null; localTime: string | null; position: { lat: number; lng: number } | null; nightDriving?: boolean; pace?: string };

/**
 * How the plan as it stands meets the real world, asked of the server when the page opens and again every 30 minutes while it is open
 * (a forecast is only as good as its age). It changes nothing. The position, when there is a precise one, goes with the request and is not
 * kept. Offline or on a server problem the last answer stays, marked with when it was made: it is never shown as live.
 */
export function useConditions({ tripId, enabled, localDate, localTime, position, nightDriving, pace }: Args) {
  const [fuel, setFuel] = useLocalJson<{ pct?: number | null }>(fuelKey(tripId), EMPTY_FUEL);
  const [report, setReport] = useState<ConditionsReport | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ localDate, localTime, position, nightDriving, pace, pct: fuel.pct ?? null });
  useEffect(() => { latest.current = { localDate, localTime, position, nightDriving, pace, pct: fuel.pct ?? null }; });

  const refresh = useCallback(async () => {
    const a = latest.current;
    if (!a.localDate || !a.localTime) return;
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch(`/api/trips/${tripId}/conditions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_date: a.localDate, local_time: a.localTime, ...(a.nightDriving ? { night_driving: true } : {}), ...(a.pace ? { pace: a.pace } : {}), ...(a.pct !== null ? { fuel_percent: a.pct } : {}), ...(a.position ? { lat: a.position.lat, lng: a.position.lng } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ConditionsReport> & { error?: string };
      if (!res.ok) { setStatus((s) => (s === "ready" ? s : "error")); setError(body.error ?? "Couldn't check your plan right now."); return; }
      setReport({ items: body.items ?? [], unresolved: body.unresolved ?? [], limitations: body.limitations ?? [], asOf: body.asOf ?? Date.now(), hasDates: body.hasDates ?? true });
      setStatus("ready"); setError(null);
    } catch {
      setStatus((s) => (s === "ready" ? s : "error")); setError("No connection. Showing what we last knew.");
    }
  }, [tripId]);

  const ready = enabled && !!localDate && !!localTime;
  useEffect(() => {
    if (!ready) return;
    const first = window.setTimeout(() => void refresh(), 0);
    const every = window.setInterval(() => { if (typeof document === "undefined" || document.visibilityState !== "hidden") void refresh(); }, REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(every); };
  }, [ready, refresh, fuel.pct, nightDriving, pace]);

  const setFuelPct = useCallback((pct: number | null) => setFuel({ pct }), [setFuel]);
  return { report, status, error, refresh, fuelPct: fuel.pct ?? null, setFuelPct };
}
export type Conditions = ReturnType<typeof useConditions>;
