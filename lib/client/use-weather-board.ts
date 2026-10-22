"use client";

// Keeps a weather board (lib/forecast/board.ts) fresh by itself: the traveller never presses refresh.
//   • fetched when a place needs days the app does not have yet (a stop added, an ETA that moved to another day, a picked time)
//   • fetched again when what is shown is 30 minutes old; checked every minute, when the app comes back into view, and when the
//     connection returns; after a failure it tries again after 1, then 2, then 5 minutes
//   • while refreshing, the last good answer stays on screen (no flicker); over 60 minutes old it is not shown at all (the core rules)
//   • an ETA that changes only re-computes (the forecast for the new time is usually already here): no request
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { areaOf, daysBetween } from "@/lib/forecast/areas";
import { buildBoard, neededWindows, type Board, type BoardInput, type BoardPlace } from "@/lib/forecast/board";
import type { WeatherAlert } from "@/lib/forecast/alerts";
import { WEATHER_REFRESH_MS } from "@/lib/weather-rules";
import { weatherStore, type FetchResult } from "./weather-store";

export type WeatherBoard = {
  /** "loading": nothing yet and asking; "ready": a forecast is shown; "offline"/"error"/"limited"/"signed-out": nothing could be fetched. */
  status: "idle" | "loading" | "ready" | "offline" | "error" | "limited" | "signed-out";
  /** The last refresh failed (what is shown is older, and disappears after 60 minutes). */
  problem: Exclude<FetchResult, "ok"> | null;
  refreshing: boolean;
  /** When the OLDEST forecast in use was fetched, or null. */
  fetchedAt: number | null;
  places: BoardPlace[];
  alerts: WeatherAlert[];
  today: Board["today"];
  tip: string | null;
};

const RETRY_MS = [60_000, 120_000, 300_000];
const CHECK_EVERY_MS = 60_000;
const IDLE: WeatherBoard = { status: "idle", problem: null, refreshing: false, fetchedAt: null, places: [], alerts: [], today: null, tip: null };

/** A key that changes only when the AREAS or DAYS needed change (not on every ETA minute), so fetching follows real needs. */
function needKey(input: BoardInput): string {
  return neededWindows(input).map((w) => `${areaOf(w).key}:${daysBetween(w.from, w.to).join(",")}`).sort().join("|");
}

/** A key for what the board is computed from (the minute, the mode, rounded positions, the times), so it is not rebuilt on every GPS fix. */
function inputKey(input: BoardInput): string {
  const r = (n: number) => n.toFixed(3);
  return JSON.stringify([
    Math.floor(input.nowMs / 60_000), input.mode,
    input.here ? [r(input.here.lat), r(input.here.lng), input.here.label] : null,
    input.stops.map((s) => [s.id, s.name, r(s.lat), r(s.lng), s.isNext, s.liveEta && Math.floor(s.liveEta / 60_000), s.planned, s.dayISO, s.typical?.text ?? null]),
    input.road.map((p) => [p.id, r(p.lat), r(p.lng), Math.floor(p.at / 60_000)]),
  ]);
}

export function useWeatherBoard(input: BoardInput & { enabled: boolean; fetchImpl?: typeof fetch }): WeatherBoard {
  const version = useSyncExternalStore(weatherStore.subscribe, weatherStore.version, () => 0);
  const [fetchState, setFetchState] = useState<{ result: FetchResult | null; busy: boolean }>({ result: null, busy: false });
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });
  const failures = useRef(0);
  const nextTry = useRef(0);
  const busy = useRef(false);

  const need = input.enabled ? needKey(input) : "";
  useEffect(() => {
    if (!need) return;
    let disposed = false;
    const check = async (force = false) => {
      const cur = latest.current;
      if (busy.current || disposed) return;
      const now = Date.now();
      const windows = neededWindows({ ...cur, nowMs: now });
      const oldest = weatherStore.oldestFetch(windows.map((w) => ({ ...w })));
      const due = oldest === null || now - oldest >= WEATHER_REFRESH_MS;
      if (!due || (!force && now < nextTry.current)) return;
      busy.current = true;
      setFetchState((s) => ({ ...s, busy: true }));
      const result = await weatherStore.fetch(windows, cur.fetchImpl);
      busy.current = false;
      if (disposed) return;
      // "ok" but a place still has nothing (its area is unavailable right now) counts as a miss too: no asking again every minute.
      const complete = result === "ok" && weatherStore.oldestFetch(windows) !== null;
      if (complete) { failures.current = 0; nextTry.current = 0; }
      else { nextTry.current = Date.now() + RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]; failures.current++; }
      setFetchState({ result, busy: false });
    };
    void check(true);
    const t = setInterval(() => void check(), CHECK_EVERY_MS);
    const onBack = () => { if (typeof document === "undefined" || document.visibilityState === "visible") void check(true); };
    if (typeof document !== "undefined") document.addEventListener?.("visibilitychange", onBack);
    if (typeof window !== "undefined") window.addEventListener?.("online", onBack);
    return () => {
      disposed = true;
      clearInterval(t);
      if (typeof document !== "undefined") document.removeEventListener?.("visibilitychange", onBack);
      if (typeof window !== "undefined") window.removeEventListener?.("online", onBack);
    };
  }, [need]);

  const key = input.enabled ? inputKey(input) : "";
  return useMemo<WeatherBoard>(() => {
    if (!key) return IDLE;
    const horizon = weatherStore.horizonEnd() ?? undefined;
    const { places, alerts, today, tip } = buildBoard(input, (p, from, to) => weatherStore.area(p, from, to), horizon);
    // The oldest forecast actually shown (places without one say so themselves).
    const shown = places.map((p) => (p.moment?.status === "ok" ? p.moment.fetchedAt : null)).filter((t): t is number => t !== null);
    const fetchedAt = shown.length ? Math.min(...shown) : null;
    const anyData = places.some((p) => p.moment?.status === "ok" || !!p.parts);
    const problem = fetchState.result && fetchState.result !== "ok" ? fetchState.result : null;
    const status: WeatherBoard["status"] = anyData ? "ready" : fetchState.busy || fetchState.result === null ? "loading" : problem ?? "ready";
    return { status, problem, refreshing: fetchState.busy, fetchedAt, places, alerts, today, tip };
    // `version`: the store changed; `key`: what the board depends on changed. `input` is a new object every render: the key stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, fetchState]);
}
