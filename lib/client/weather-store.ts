"use client";

// The app's weather, shared by every screen (the drive, the map, the live page, the plan, the trip's weather page): one copy per
// forecast area and day, so moving between screens never fetches again and never shows two different answers.
//   • kept per area and UTC day, with the time it was fetched; a screen asks for the days it needs and gets the OLDEST fetch time of
//     what it uses (so "how old is this" is never flattered)
//   • fetched through /api/weather; one request at a time per set of places; a failure keeps what was there (it ages out by itself:
//     lib/forecast/moment.ts shows nothing over 60 minutes old)
import { areaOf, daysBetween, dayStartMs, utcDay } from "@/lib/forecast/areas";
import type { AreaData } from "@/lib/forecast/moment";
import { decodeArea, type WeatherResponse } from "@/lib/forecast/wire";
import type { ForecastStep } from "@/lib/providers/types";

type Day = { steps: ForecastStep[]; fetchedAt: number };
const days = new Map<string, Day>();
const listeners = new Set<() => void>();
let version = 0;
let horizonEnd: number | null = null;
const inflight = new Map<string, Promise<FetchResult>>();
const MAX_DAYS = 2_000;
/** The API takes at most this many places per request (lib/validation/schemas.ts weatherSchema). */
const MAX_PLACES_PER_REQUEST = 60;

export type WeatherPlace = { id: string; lat: number; lng: number; from: number; to: number };
export type FetchResult = "ok" | "offline" | "error" | "limited" | "signed-out";

const key = (area: string, day: string) => `${area}|${day}`;
const bump = () => { version++; listeners.forEach((l) => l()); };

export const weatherStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  version: () => version,
  horizonEnd: () => horizonEnd,
  /** One area's forecast over [from, to]: the days it has, and the oldest fetch time among them. Null when it has none of them. */
  area(p: { lat: number; lng: number }, from: number, to: number): AreaData | null {
    const a = areaOf(p);
    const steps: ForecastStep[] = [];
    let fetchedAt = Infinity;
    for (const d of daysBetween(from, to)) {
      const e = days.get(key(a.key, d));
      if (!e) continue;
      fetchedAt = Math.min(fetchedAt, e.fetchedAt);
      for (const s of e.steps) if (s.time >= from - 3_600_000 && s.time <= to + 3_600_000) steps.push(s);
    }
    return steps.length ? { steps, fetchedAt } : null;
  },
  /** The oldest fetch time of the days these places need (Infinity-safe: null when a needed day is missing). */
  oldestFetch(places: WeatherPlace[]): number | null {
    let oldest = Infinity;
    for (const p of places) for (const d of daysBetween(p.from, Math.min(p.to, horizonEnd ?? p.to))) {
      const e = days.get(key(areaOf(p).key, d));
      if (!e) return null;
      oldest = Math.min(oldest, e.fetchedAt);
    }
    return Number.isFinite(oldest) ? oldest : null;
  },
  /** Fetch these places' windows: at most 60 places per request (a large trip is split), all at once. Worst result wins. */
  async fetch(asked: WeatherPlace[], fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
    if (asked.length === 0) return "ok";
    const chunks: WeatherPlace[][] = [];
    for (let i = 0; i < asked.length; i += MAX_PLACES_PER_REQUEST) chunks.push(asked.slice(i, i + MAX_PLACES_PER_REQUEST));
    const results = await Promise.all(chunks.map((c) => weatherStore.fetchChunk(c, fetchImpl)));
    const order: FetchResult[] = ["signed-out", "limited", "offline", "error", "ok"];
    return results.reduce((worst, r) => (order.indexOf(r) < order.indexOf(worst) ? r : worst), "ok" as FetchResult);
  },
  /** One request (at most 60 places). Concurrent identical requests share one call. */
  fetchChunk(asked: WeatherPlace[], fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
    if (asked.length === 0) return Promise.resolve("ok");
    // Whole GMT days: the store keeps whole days, so a day is never replaced by part of itself.
    const places = asked.map((p) => ({ ...p, from: dayStartMs(utcDay(p.from)), to: dayStartMs(utcDay(p.to)) + 23 * 3_600_000 }));
    const reqKey = places.map((p) => `${p.id}@${p.lat.toFixed(3)},${p.lng.toFixed(3)}:${p.from}-${p.to}`).join("|");
    const running = inflight.get(reqKey);
    if (running) return running;
    const job = (async (): Promise<FetchResult> => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
      try {
        const from = Math.min(...places.map((p) => p.from)), to = Math.max(...places.map((p) => p.to));
        const res = await fetchImpl("/api/weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ places, from, to }) });
        if (res.status === 401) return "signed-out";
        if (res.status === 429) return "limited";
        if (!res.ok) return "error";
        const body = (await res.json()) as WeatherResponse;
        horizonEnd = body.horizonEnd;
        for (const [area, w] of Object.entries(body.areas)) {
          if (!w) continue; // unavailable now: keep what we had (it ages out by itself)
          const byDay = new Map<string, ForecastStep[]>();
          for (const s of decodeArea(w)) { const d = new Date(s.time).toISOString().slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(s); }
          for (const [d, steps] of byDay) {
            const k = key(area, d);
            const cur = days.get(k);
            if (cur && cur.fetchedAt > w.fetchedAt) continue; // never replace a newer answer with an older one
            // A partial day (the window cut it) adds to what is there instead of dropping the rest of the day.
            const merged = cur && cur.fetchedAt === w.fetchedAt ? [...new Map([...cur.steps, ...steps].map((s) => [s.time, s])).values()].sort((a, b) => a.time - b.time) : steps;
            days.delete(k); days.set(k, { steps: merged, fetchedAt: w.fetchedAt });
          }
        }
        while (days.size > MAX_DAYS) days.delete(days.keys().next().value as string);
        bump();
        return "ok";
      } catch {
        return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error";
      } finally {
        inflight.delete(reqKey);
      }
    })();
    inflight.set(reqKey, job);
    return job;
  },
  /** Tests only. */
  clear() { days.clear(); inflight.clear(); horizonEnd = null; bump(); },
};
