// Fresh community updates make a place more trustworthy: a recent report from someone who was actually there beats a stale map entry.
import { haversineM } from "./route-geometry";
import { poiKey } from "./ranking";
import type { PoiRecord } from "@/lib/poi/types";

export type ReportLite = { lat: number; lng: number; photo_path: string | null; created_at: string };

export const COMMUNITY_RADIUS_M = 300;

/** 0..1 boost per place key: more reports and more recent ones count for more. */
export function communityBoost(pois: PoiRecord[], reports: ReportLite[], nowMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pois) {
    let score = 0;
    for (const r of reports) {
      if (haversineM(p, r) > COMMUNITY_RADIUS_M) continue;
      const ageDays = (nowMs - Date.parse(r.created_at)) / 86_400_000;
      if (!(ageDays >= -1 && ageDays <= 60)) continue;
      score += ageDays <= 7 ? 0.5 : ageDays <= 21 ? 0.35 : 0.2;
    }
    if (score > 0) out[poiKey(p)] = Math.min(1, Math.round(score * 100) / 100);
  }
  return out;
}

/** The newest real photo taken within ~300 m of a place, or null. */
export function communityPhotoPath(poi: { lat: number; lng: number }, reports: ReportLite[]): string | null {
  let best: ReportLite | null = null;
  for (const r of reports) {
    if (!r.photo_path || haversineM(poi, r) > COMMUNITY_RADIUS_M) continue;
    if (!best || r.created_at > best.created_at) best = r;
  }
  return best?.photo_path ?? null;
}
