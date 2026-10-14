import { Glyph } from "@/components/ui/Glyph";
import type { WeatherVisual } from "@/lib/travel/weather-visual";

const STYLE: Record<WeatherVisual["kind"], { box: string; icon: "rain" | "wind" | "sun" | "thermometer" | "check"; text: string }> = {
  wind: { box: "border-[#b8c7d3] bg-[#EDF2F6]", icon: "wind", text: "text-[#2f4a60]" },
  rain: { box: "border-[#9ec9d9] bg-[#E6F3F8]", icon: "rain", text: "text-[#12546b]" },
  heat: { box: "border-marigold/60 bg-marigold-light", icon: "sun", text: "text-[#7a4a00]" },
  cool: { box: "border-[#b9cfe3] bg-[#EAF1F8]", icon: "thermometer", text: "text-[#274a6d]" },
  fair: { box: "border-line bg-sky/60", icon: "check", text: "text-ink-muted" },
};

/**
 * The weather at a stop, in words: what it is, which day it is for (or that it is only the season's usual), the numbers, and one line
 * of advice when a real forecast calls for it. Nothing moves: motion adds no information that a sentence does not.
 */
export function WeatherChip({ v }: { v: WeatherVisual }) {
  const s = STYLE[v.kind];
  return (
    <div className={`rounded-xl border px-3 py-2 ${s.box}`} data-weather={v.kind} data-basis={v.basis}>
      <p className={`flex items-center gap-2 text-sm font-semibold ${s.text}`}>
        <Glyph name={s.icon} size={16} />
        <span>{v.headline}</span>
      </p>
      <p className="mt-0.5 text-xs text-ink-muted"><span className="font-semibold">{v.basisLabel}.</span> {v.detail}</p>
      {v.advice && <p className="mt-1 text-sm text-ink">{v.advice}</p>}
    </div>
  );
}
