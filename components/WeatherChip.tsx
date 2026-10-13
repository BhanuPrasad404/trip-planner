import { Glyph } from "@/components/ui/Glyph";
import type { WeatherVisual } from "@/lib/travel/weather-visual";

const STYLE: Record<WeatherVisual["kind"], { box: string; icon: "rain" | "sun" | "thermometer" | "check"; text: string }> = {
  rain: { box: "border-[#9ec9d9] bg-[#E6F3F8]", icon: "rain", text: "text-[#12546b]" },
  heat: { box: "border-marigold/60 bg-marigold-light", icon: "sun", text: "text-[#7a4a00]" },
  cool: { box: "border-[#b9cfe3] bg-[#EAF1F8]", icon: "thermometer", text: "text-[#274a6d]" },
  fair: { box: "border-line bg-sky/60", icon: "check", text: "text-ink-muted" },
};

/**
 * The weather at a stop: words first (always readable), with a restrained animation only when the data calls for it:
 * raindrops for rain (more drops for more rain), a soft warm glow for real heat. Nothing moves for fair or cool weather, nothing
 * moves for people who prefer reduced motion, and a "typical for the season" chip is labelled as that, never as a forecast.
 */
export function WeatherChip({ v }: { v: WeatherVisual }) {
  const s = STYLE[v.kind];
  return (
    <div className={`relative isolate overflow-hidden rounded-xl border px-3 py-2 ${s.box}`} data-weather={v.kind} data-basis={v.basis}>
      {v.drops > 0 && (
        <span aria-hidden="true" className="tm-rain pointer-events-none absolute inset-0 -z-10">
          {Array.from({ length: v.drops }, (_, i) => <i key={i} style={{ left: `${6 + ((i * 89) % 88)}%`, animationDelay: `${(i * 173) % 1000}ms`, animationDuration: `${1.4 - v.intensity * 0.2}s` }} />)}
        </span>
      )}
      {v.kind === "heat" && v.intensity >= 2 && <span aria-hidden="true" className="tm-heat-glow pointer-events-none absolute -right-6 -top-6 -z-10 h-20 w-20 rounded-full bg-[radial-gradient(circle,rgba(232,163,61,0.55),transparent_70%)]" />}
      <p className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold ${s.text}`}>
        <Glyph name={s.icon} size={16} />
        <span>{v.headline}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{v.basisLabel}</span>
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">{v.detail}</p>
      {v.advice && <p className="mt-1 text-sm text-ink">{v.advice}</p>}
    </div>
  );
}
