// Travel Radar: the handful of things AHEAD that are worth knowing about right now — one best pick per kind,
// in the order you will reach them, with the facts that matter (minutes ahead, detour, open, timely context).
import { localMinute } from "./ranking";
import type { RadarItem, RankedPoi } from "./types";

type Args = { ranked: RankedPoi[]; nowMs: number; utcOffsetMin: number; sunsetMin: number | null; limit?: number };

const RADAR_KINDS = ["fuel", "food", "cafe", "restroom", "viewpoint", "sight", "pharmacy", "stay", "ev", "hospital", "atm", "repair"] as const;

export function buildRadar({ ranked, nowMs, utcOffsetMin, sunsetMin, limit = 6 }: Args): RadarItem[] {
  const out: RadarItem[] = [];
  for (const kind of RADAR_KINDS) {
    // Close enough to matter (within ~90 min of driving) and good enough to recommend.
    const best = ranked.filter((r) => r.kind === kind && r.etaMin <= 90 && r.score >= 40).sort((a, b) => b.score - a.score)[0];
    if (!best) continue;
    let note: string | null = null;
    if (kind === "viewpoint" && sunsetMin !== null) {
      const untilSunset = sunsetMin - localMinute(nowMs + best.etaMin * 60_000, utcOffsetMin);
      if (untilSunset > 0 && untilSunset <= 120) note = `Sunset ${untilSunset} min after you arrive`;
    }
    out.push({ key: best.key, kind, name: best.name, lat: best.lat, lng: best.lng, etaMin: best.etaMin, aheadKm: best.aheadKm, detourMin: best.detourMin, open: best.open, note, score: best.score, hours: best.hours, fetchedAt: best.fetchedAt });
  }
  // Sooner first, and keep the best few — a radar that shows everything is not a radar.
  return out.sort((a, b) => a.etaMin - b.etaMin).slice(0, limit);
}
