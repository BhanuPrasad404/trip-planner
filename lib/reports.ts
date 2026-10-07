// Community "fresh updates" about a place (see migration place_reports).
// Reports belong to a place on the map, not to one trip: anyone planning near that place sees them.
import { distanceKm } from "@/lib/geo";

export const REPORT_TAGS = {
  water_flowing: { label: "Water flowing" },
  dry: { label: "Dry / low water" },
  crowded: { label: "Crowded" },
  quiet: { label: "Quiet" },
  road_good: { label: "Road is good" },
  road_bad: { label: "Road is bad" },
  closed: { label: "Closed" },
  great_view: { label: "Great view" },
  muddy: { label: "Muddy / slippery" },
} as const;

export type ReportTag = keyof typeof REPORT_TAGS;
export const REPORT_TAG_IDS = Object.keys(REPORT_TAGS) as [ReportTag, ...ReportTag[]];

export const REPORT_RADIUS_KM = 1.5; // a report counts for a stop if it was made this close to it
export const REPORT_MAX_AGE_DAYS = 60;
export const REPORT_PHOTO_BUCKET = "report-photos";

/** A row from the place_reports table. */
export type PlaceReportRow = {
  id: string;
  user_id: string;
  place_name: string;
  lat: number;
  lng: number;
  tags: string[];
  note: string | null;
  photo_path: string | null;
  created_at: string;
};

/** What the UI needs. Authors are never named — only whether it is yours. */
export type ReportView = {
  id: string;
  tags: ReportTag[];
  note: string | null;
  photoUrl: string | null;
  createdAt: string;
  mine: boolean;
};

const isTag = (t: string): t is ReportTag => t in REPORT_TAGS;

/** Give each report to the NEAREST stop within the radius, newest first, a few per stop. */
export function assignReports(
  places: { id: string; lat: number; lng: number }[],
  reports: PlaceReportRow[],
  userId: string,
  photoUrl: (path: string) => string | null,
  perPlace = 5
): Record<string, ReportView[]> {
  const out: Record<string, ReportView[]> = {};
  const sorted = [...reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const r of sorted) {
    let best: { id: string; km: number } | null = null;
    for (const p of places) {
      const km = distanceKm(p, r);
      if (km <= REPORT_RADIUS_KM && (!best || km < best.km)) best = { id: p.id, km };
    }
    if (!best) continue;
    const list = (out[best.id] ??= []);
    if (list.length >= perPlace) continue;
    list.push({
      id: r.id,
      tags: r.tags.filter(isTag),
      note: r.note,
      photoUrl: r.photo_path ? photoUrl(r.photo_path) : null,
      createdAt: r.created_at,
      mine: r.user_id === userId,
    });
  }
  return out;
}

/** Counts each tag over the last N days, most-reported first. */
export function summarizeReports(reports: ReportView[], now: Date, windowDays = 30) {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const recent = reports.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
  const counts = new Map<ReportTag, number>();
  for (const r of recent) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  const latest = recent[0]?.createdAt ?? null; // reports arrive newest-first
  return { count: recent.length, top, latest };
}

export function timeAgo(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return "just now";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** Storage paths are `<user id>/<file>`; anything else is refused (blocks pointing a report at someone else's file). */
export function isOwnPhotoPath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`) && /^[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]{1,100}$/.test(path);
}
