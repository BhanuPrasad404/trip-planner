"use client";

// While driving: opening-hours alerts for the coming stops at their LIVE arrival times (lib/travel/hours-alerts.ts), in the app's alert
// list, never as a phone notification and never with sound. The hours are the trip's own saved hours, read by the server
// (GET /api/trips/[id]/hours, the same route Trip Check uses): the browser only compares numbers. Nothing about where you are is sent:
// the request carries the trip and a date only. Offline, or when the hours can't be loaded, nothing is said.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppAlert } from "@/lib/alerts/delivery";
import { evaluatorFromIntervals, mergeIntervals, type OpenInterval } from "@/lib/travel/hours-intervals";
import { clearHoursAlerts, findHoursProblems, stepHoursAlerts, type HoursAction, type HoursMemory, type LiveHoursStop } from "@/lib/travel/hours-alerts";
import { dateOf, INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";

type Channel = { notify: (a: AppAlert) => boolean; update: (a: AppAlert) => void; escalate: (a: AppAlert) => void; withdraw: (id: string) => void };
export type DriveHoursStop = Omit<LiveHoursStop, "evaluate" | "nextOpenMs">;
type Window = { fromMs: number; toMs: number; stops: Record<string, { status: "ok"; intervals: OpenInterval[] } | { status: "unverifiable"; reason: string }> };

/** The trip's hours read by the server, as numbers the browser can judge with (null = none we can use). Pure. */
export function withEvaluators(stops: DriveHoursStop[], w: Window | null): LiveHoursStop[] {
  return stops.map((s) => {
    const e = w?.stops[s.id];
    if (!w || !s.hours || !e || e.status !== "ok") return s;
    const list = mergeIntervals(e.intervals);
    return {
      ...s,
      evaluate: evaluatorFromIntervals({ fromMs: w.fromMs, toMs: w.toMs, intervals: e.intervals }, INDIA_UTC_OFFSET_MIN),
      nextOpenMs: (after) => list.find(([a, , unknown]) => a > after && !unknown)?.[0] ?? null,
    };
  });
}

export function useHoursDriveAlerts(tripId: string, driving: boolean, nowMs: number, stops: DriveHoursStop[], channel: Channel) {
  const ch = useRef(channel);
  useEffect(() => { ch.current = channel; });
  const memory = useRef<HoursMemory>(new Map());
  const run = (actions: HoursAction[]) => {
    for (const a of actions) {
      if (a.type === "withdraw") ch.current.withdraw(a.id);
      else if (a.type === "notify") ch.current.notify(a.alert);
      else if (a.type === "escalate") ch.current.escalate(a.alert);
      else ch.current.update(a.alert);
    }
  };

  // The hours window: today in India (the route covers the day before to three days after), again when the saved hours change.
  const date = nowMs > 0 ? dateOf(nowMs, INDIA_UTC_OFFSET_MIN) : null;
  const hoursKey = stops.map((s) => `${s.id}=${s.hours ?? ""}`).join("|");
  const key = driving && date && stops.some((s) => s.hours) ? `${tripId}|${date}|${hoursKey}` : null;
  const [win, setWin] = useState<{ key: string; w: Window | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    fetch(`/api/trips/${tripId}/hours?date=${key.split("|")[1]}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Window) => setWin({ key, w: d && Number.isFinite(d.fromMs) && Number.isFinite(d.toMs) && d.stops ? d : null }))
      .catch(() => { if (!ctrl.signal.aborted) setWin({ key, w: null }); });      // offline or failed: no window, so nothing is said
    return () => ctrl.abort();
  }, [tripId, key]);
  const w = key && win?.key === key ? win.w : null;

  const judged = useMemo(() => withEvaluators(stops, w), [stops, w]);
  const activeIds = useMemo(() => new Set(stops.map((s) => s.id)), [stops]);
  useEffect(() => {
    if (!driving) { run(clearHoursAlerts(memory.current, tripId)); return; }
    run(stepHoursAlerts(memory.current, findHoursProblems(judged, nowMs), activeIds, tripId, nowMs));
  }, [driving, judged, activeIds, nowMs, tripId]);
}
