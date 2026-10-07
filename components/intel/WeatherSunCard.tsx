import type { IntelResult } from "@/lib/intel/types";
import { Glyph } from "@/components/ui/Glyph";
import { WhenChip } from "@/components/ui/WhenChip";

type Props = {
  weather: IntelResult["weatherNow"];
  sun: IntelResult["sun"];
  sunNext: IntelResult["sunNext"];
  /** Where the forecast is for: "your location", or the place the preview starts from. */
  where: string;
  /** When this forecast was fetched (ms). */
  updatedAt?: number | null;
  /** Set while the trip has not started: says that this is TODAY's weather at the start, not the trip-day forecast. */
  tripNote?: string | null;
  /** Wall-clock now (ms), so "updated 4 min ago" is computed by the caller, not during render. */
  nowMs?: number;
};

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`);
const rain = (p: number | null, mm: number) => (p !== null ? `${Math.round(p)}% rain` : mm > 0 ? `${mm} mm` : "no rain");

/** Weather right now and the next hours, plus the sun — the two things a traveller checks first. Real forecast data, credited. */
export function WeatherSunCard({ weather, sun, sunNext, where, updatedAt, tripNote, nowMs }: Props) {
  const age = updatedAt && nowMs ? Math.max(0, Math.round((nowMs - updatedAt) / 60_000)) : null;
  return (
    <section aria-labelledby="wx-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wx-heading" className="font-display text-lg font-semibold text-pine">Weather &amp; sun</h2>
        <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink-muted">
          <WhenChip kind="now" detail={age === null ? undefined : age < 1 ? "updated just now" : `updated ${age} min ago`} /> at {where}
        </p>
      </div>
      {tripNote && <p className="mt-2 rounded-lg bg-sky px-3 py-1.5 text-xs text-ink-muted">{tripNote}</p>}

      <div className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        {weather ? (
          <div>
            <p className="font-display text-4xl font-semibold leading-none text-pine">{weather.tempC}°C</p>
            <p className="mt-1 text-sm text-ink-muted">{rain(weather.precipProb, weather.precipMm)} this hour</p>
            {weather.pointKm >= 15 && <p className="mt-1 text-xs text-clay-ink">Forecast point is {weather.pointKm} km away.</p>}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">The forecast isn&apos;t available right now. We don&apos;t guess the weather.</p>
        )}

        {weather && weather.next.length > 0 && (
          <ol className="flex gap-2 overflow-x-auto" aria-label="Next hours">
            {weather.next.map((h) => (
              <li key={h.clock} className="shrink-0 rounded-xl bg-sky px-3 py-2 text-center">
                <p className="font-mono text-xs text-ink-muted">{h.clock}</p>
                <p className="font-semibold text-pine">{h.tempC}°</p>
                <p className={`text-xs ${(h.precipProb ?? 0) >= 60 ? "font-semibold text-clay-ink" : "text-ink-muted"}`}>{h.precipProb !== null ? `${Math.round(h.precipProb)}%` : "—"}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {sun && sunNext && (
        <p className="mt-3 border-t border-line pt-3 text-sm">
          <Glyph name={sunNext.label === "Sunset" ? "sunset" : "sunrise"} size={16} className="mr-1.5 inline align-text-bottom text-marigold" />
          <strong className="text-pine">{sunNext.label}{sunNext.tomorrow ? " tomorrow" : ""} {sunNext.clock}</strong>
          <span className="text-ink-muted"> · in {dur(sunNext.inMin)} · today (there): sunrise {sun.sunrise}, sunset {sun.sunset}</span>
        </p>
      )}

      <p className="mt-2 text-[11px] text-ink-muted">
        Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Open-Meteo.com<span className="sr-only"> (opens in a new tab)</span></a>. Sun times are calculated for your position.
      </p>
    </section>
  );
}
