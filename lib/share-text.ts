// A WhatsApp-ready text version of the plan (WhatsApp renders *bold*).
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { dateOfTripDay } from "@/lib/dates";
import { formatDate, formatDuration } from "@/lib/format";
import type { Place, Trip } from "@/lib/types";

type SharePlace = Pick<Place, "id" | "name" | "day_number" | "sequence_order" | "arrival_time" | "drive_minutes" | "drive_km" | "category">;

export type ShareInput = {
  trip: Pick<Trip, "name" | "start_city" | "dest_name" | "start_date" | "num_days">;
  places: SharePlace[];
  /** Short warning/praise per place id, e.g. "⚠ poor timing". */
  flags?: Record<string, string>;
  link?: string;
};

export function buildItineraryText({ trip, places, flags = {}, link }: ShareInput): string {
  const route = trip.start_city && trip.dest_name ? `${trip.start_city} → ${trip.dest_name}` : trip.dest_name || trip.name;
  const lines: string[] = [`🧭 *${route}* — ${trip.num_days} ${trip.num_days === 1 ? "day" : "days"}`];

  const first = dateOfTripDay(trip.start_date, 1);
  const last = dateOfTripDay(trip.start_date, trip.num_days);
  if (first && last) {
    const f = (d: Date) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });
    lines.push(`📅 ${trip.num_days === 1 ? f(first) : `${f(first)} – ${f(last)}`}`);
  }

  const scheduled = places.filter((p) => p.day_number !== null);
  const ideas = places.filter((p) => p.day_number === null);

  for (let day = 1; day <= trip.num_days; day++) {
    const stops = scheduled
      .filter((p) => p.day_number === day)
      .sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
    if (stops.length === 0) continue;
    const date = dateOfTripDay(trip.start_date, day);
    lines.push("", `*Day ${day}${date ? ` · ${formatDate(date, { weekday: "short", day: "numeric", month: "short" })}` : ""}*`);
    for (const p of stops) {
      if (p.drive_minutes) {
        lines.push(`   🚗 ${formatDuration(p.drive_minutes)}${p.drive_km != null ? ` · ${Math.round(p.drive_km)} km` : ""}`);
      }
      const time = p.arrival_time ? `${p.arrival_time.slice(0, 5)} — ` : "• ";
      const flag = flags[p.id] ? `  ${flags[p.id]}` : "";
      lines.push(`${time}${CATEGORIES[normalizeCategory(p.category)].emoji} ${p.name}${flag}`);
    }
  }

  if (ideas.length > 0) lines.push("", `💡 *Still to schedule:* ${ideas.map((p) => p.name).join(", ")}`);
  if (link) lines.push("", `Plan together on Trailmate: ${link}`);
  return lines.join("\n");
}
