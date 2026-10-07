import type { HealthTone, TripHealth } from "@/lib/intel/types";

const TONE: Record<HealthTone, string> = { good: "bg-teal-light text-teal-ink", warn: "bg-marigold-light text-[#7a4a00]", bad: "bg-clay-light text-clay-ink", unknown: "bg-sky text-ink-muted" };
const dur = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;

/** Four honest numbers about how today is going. "Unknown" is shown as unknown — never as "good". */
export function TripHealthStrip({ health }: { health: TripHealth | null }) {
  const tiles = health
    ? [
        { k: "Schedule", v: health.schedule.label, d: health.schedule.detail, t: health.schedule.tone },
        { k: "Driving left", v: health.driving.label, d: dur(health.driving.minutes), t: health.driving.tone },
        { k: "Weather", v: health.weather.label, d: health.weather.detail, t: health.weather.tone },
        { k: "Time left today", v: health.timeLeftMin === null ? "—" : dur(health.timeLeftMin), d: "until your day's target end", t: "unknown" as HealthTone },
      ]
    : [];
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Trip health" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.k} className={`rounded-2xl px-4 py-3 ${TONE[t.t]}`}>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest opacity-80">{t.k}</p>
          <p className="font-display text-xl font-semibold leading-tight">{t.v}</p>
          <p className="mt-0.5 line-clamp-2 text-xs opacity-90">{t.d}</p>
        </div>
      ))}
    </section>
  );
}
