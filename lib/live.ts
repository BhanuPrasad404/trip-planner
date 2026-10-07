// Pure helpers for the live drive screen: when to publish a position, how fresh a friend's dot is,
// and "how far / how long / what time do we arrive" for the next stops.
import type { RouteLeg } from "@/lib/eta";
import { haversineM } from "@/lib/geo";
import { toMinutes } from "@/lib/replan";

export type Fix = { lat: number; lng: number; at: number };

const metres = haversineM;

/**
 * Publish a new position when it matters: after real movement (and not more than every 8 s),
 * or as a heartbeat every 60 s so a stationary friend doesn't look "gone".
 */
export function shouldPublish(last: Fix | null, cur: Fix): boolean {
  if (!last) return true;
  const seconds = (cur.at - last.at) / 1000;
  if (seconds >= 60) return true;
  return seconds >= 8 && metres(last, cur) >= 15;
}

export type Freshness = "live" | "recent" | "stale";

export function freshness(updatedAtIso: string, nowMs: number): Freshness {
  const age = nowMs - new Date(updatedAtIso).getTime();
  if (age < 2 * 60_000) return "live";
  if (age < 10 * 60_000) return "recent";
  return "stale";
}

export function lastSeenText(updatedAtIso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - new Date(updatedAtIso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ago`;
}

export const formatDistance = (km: number): string => (km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

/** "14:32", or "00:20 (+1 day)" when the arrival is past midnight. */
export function formatClock(totalMinutes: number): string {
  const m = Math.round(totalMinutes);
  const day = Math.floor(m / 1440);
  const inDay = ((m % 1440) + 1440) % 1440;
  const text = `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`;
  return day > 0 ? `${text} (+${day} day)` : text;
}

export type DriveStop = { id: string; name: string; plannedArrival: string | null };

export type DriveStopEta = {
  id: string;
  name: string;
  /** From your position to this stop, along the route. */
  km: number;
  minutes: number;
  eta: string;
  /** Minutes later (+) or earlier (−) than the plan; null when not comparable. */
  delayMin: number | null;
};

export type DriveSummary = {
  next: DriveStopEta;
  stops: DriveStopEta[];
  totalKm: number;
  finishEta: string;
};

/**
 * legs[i] = leg from the previous point (you, then each stop) to stops[i].
 * Visiting time at each stop is NOT included, so we add a typical stay for stops after the first.
 */
export function summarizeDrive(
  legs: RouteLeg[],
  stops: DriveStop[],
  nowMinuteOfDay: number,
  compareToPlan: boolean,
  stayMinutes: (stopId: string) => number = () => 0
): DriveSummary | null {
  const n = Math.min(legs.length, stops.length);
  if (n === 0) return null;
  const out: DriveStopEta[] = [];
  let km = 0;
  let minutes = 0;
  for (let i = 0; i < n; i++) {
    km += legs[i].km;
    minutes += legs[i].minutes;
    const arrive = nowMinuteOfDay + minutes;
    const planned = compareToPlan ? toMinutes(stops[i].plannedArrival) : null;
    out.push({
      id: stops[i].id,
      name: stops[i].name,
      km: Math.round(km * 10) / 10,
      minutes: Math.round(minutes),
      eta: formatClock(arrive),
      delayMin: planned === null ? null : Math.round(arrive - planned),
    });
    minutes += stayMinutes(stops[i].id); // time spent at this stop before driving on
  }
  return { next: out[0], stops: out, totalKm: out[out.length - 1].km, finishEta: out[out.length - 1].eta };
}

/** Human wording for a schedule difference. Within 5 minutes counts as on time. */
export function delayText(delayMin: number | null): { text: string; tone: "ok" | "late" | "early" } | null {
  if (delayMin === null) return null;
  if (Math.abs(delayMin) < 5) return { text: "On time", tone: "ok" };
  return delayMin > 0 ? { text: `${delayMin} min behind plan`, tone: "late" } : { text: `${-delayMin} min ahead of plan`, tone: "early" };
}
