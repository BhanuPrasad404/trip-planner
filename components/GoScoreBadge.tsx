import type { GoScore } from "@/lib/goscore";
import { Glyph } from "@/components/ui/Glyph";

const tones: Record<GoScore["tone"], { chip: string; dot: string }> = {
  great: { chip: "bg-teal-ink/10 text-teal-ink", dot: "bg-teal-ink text-white" },
  good: { chip: "bg-teal-light text-teal-ink", dot: "bg-teal text-white" },
  mixed: { chip: "bg-marigold-light text-[#7a4a00]", dot: "bg-marigold text-pine" },
  poor: { chip: "bg-clay-light text-clay-ink", dot: "bg-clay text-white" },
};

// Native <details> keeps this keyboard- and screen-reader-accessible with zero JS.
/**
 * The 0-100 number is shown only when it rests on BOTH curated season data and a weather forecast/average. With only one of them the
 * number is mostly the formula's starting value, so we show what we actually know in words instead of a precise-looking score.
 */
const WEATHER_ONLY: Record<GoScore["tone"], string> = { great: "Weather looks good", good: "Weather looks good", mixed: "Weather is mixed", poor: "Weather looks poor" };
export function goScoreLabel(score: GoScore): { text: string; number: number | null } {
  if (score.basis === "season+weather") return { text: `Go score · ${score.label} (${score.score}/100)`, number: score.score };
  if (score.basis === "weather") return { text: WEATHER_ONLY[score.tone], number: null };
  return { text: score.reasons[0] ?? score.label, number: null };
}

export function GoScoreBadge({ score, forDay }: { score: GoScore; forDay?: string }) {
  const t = tones[score.tone];
  const shown = goScoreLabel(score);
  return (
    <details className="group mt-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs font-semibold [&::-webkit-details-marker]:hidden">
        <span className={`inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 ${t.chip}`}>
          {shown.number !== null ? <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 font-mono text-[13px] ${t.dot}`}>{shown.number}</span> : <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />}
          <span className="text-[13px]">{shown.text}{forDay ? <span className="font-normal"> · for {forDay}</span> : null}</span>
        </span>
        <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line px-2.5 text-ink-muted transition-colors hover:border-teal hover:text-teal-ink">
          <span className="group-open:hidden">Why?</span>
          <span className="hidden group-open:inline">Hide</span>
          <Glyph name="down" size={13} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <ul className="mt-2 space-y-1 rounded-xl bg-sky/70 px-3.5 py-2.5 text-sm text-ink-muted">
        {score.reasons.map((r) => (
          <li key={r}>• {r}</li>
        ))}
        {score.basis === "weather" && <li className="pt-1 text-xs">We have no researched season data for this place, so this is about the weather only.</li>}
        {score.basis === "season" && <li className="pt-1 text-xs">No weather data for this day yet, so this is about the season only.</li>}
        <li className="pt-1 text-xs">{forDay ? `For ${forDay}. ` : ""}An estimate from {score.basis === "season+weather" ? "season and weather" : score.basis} data, not a guarantee. Conditions can change.</li>
      </ul>
    </details>
  );
}
