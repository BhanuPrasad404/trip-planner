// A precise "before" picture of stops, so any Autopilot action can be undone exactly (see /api/trips/[id]/restore).
import type { Place } from "@/lib/types";

export type PlaceSnapshot = {
  id: string;
  day_number: number | null;
  sequence_order: number | null;
  arrival_time: string | null;
  drive_minutes: number | null;
  drive_km: number | null;
  status: "planned" | "done" | "skipped";
};

export function snapshotPlaces(places: Pick<Place, "id" | "day_number" | "sequence_order" | "arrival_time" | "drive_minutes" | "drive_km" | "status">[], ids?: string[]): PlaceSnapshot[] {
  const want = ids ? new Set(ids) : null;
  return places
    .filter((p) => !want || want.has(p.id))
    .slice(0, 60)
    .map((p) => ({
      id: p.id,
      day_number: p.day_number ?? null,
      sequence_order: p.sequence_order ?? null,
      arrival_time: p.arrival_time ? p.arrival_time.slice(0, 8) : null,
      drive_minutes: p.drive_minutes ?? null,
      drive_km: p.drive_km === null || p.drive_km === undefined ? null : Number(p.drive_km),
      status: p.status ?? "planned",
    }));
}
