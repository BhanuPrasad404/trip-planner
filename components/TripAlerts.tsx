import type { TripAlert } from "@/lib/alerts";
import { Glyph } from "@/components/ui/Glyph";

/** Heads-ups for the day on screen, from the real weather forecast. Renders nothing when there is nothing to say. */
export function TripAlerts({ alerts }: { alerts: TripAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <section aria-label="Weather heads-up for this day" className="mt-3 space-y-2">
      {alerts.map((a) => (
        <p
          key={a.id}
          role={a.severity === "warn" ? "alert" : "status"}
          className={`rounded-xl border px-3 py-2.5 text-sm leading-relaxed ${a.severity === "warn" ? "border-clay/40 bg-clay-light/70 text-clay-ink" : "border-line bg-sky/60 text-ink"}`}
        >
          <Glyph name={a.severity === "warn" ? "warn" : "info"} size={15} className="mr-1.5 inline align-text-bottom" />
          {a.text}
        </p>
      ))}
    </section>
  );
}
