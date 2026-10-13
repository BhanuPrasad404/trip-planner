import type { GoScore } from "@/lib/goscore";
import { Glyph } from "@/components/ui/Glyph";

const tones: Record<GoScore["tone"], { chip: string; dot: string }> = {
  great: { chip: "bg-teal-ink/10 text-teal-ink", dot: "bg-teal-ink text-white" },
  good: { chip: "bg-teal-light text-teal-ink", dot: "bg-teal text-white" },
  mixed: { chip: "bg-marigold-light text-[#7a4a00]", dot: "bg-marigold text-pine" },
  poor: { chip: "bg-clay-light text-clay-ink", dot: "bg-clay text-white" },
};

// Native <details> keeps this keyboard- and screen-reader-accessible with zero JS.
export function GoScoreBadge({ score, forDay }: { score: GoScore; forDay?: string }) {
  const t = tones[score.tone];
  return (
    <details className="group mt-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs font-semibold [&::-webkit-details-marker]:hidden">
        <span className={`inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 ${t.chip}`}>
          <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 font-mono text-[13px] ${t.dot}`}>{score.score}</span>
          <span className="text-[13px]">Go score · {score.label}{forDay ? <span className="font-normal"> · for {forDay}</span> : null}</span>
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
        <li className="pt-1 text-xs">{forDay ? `For ${forDay}. ` : ""}Estimate based on {score.basis.replace("+", " + ")} data — conditions can change.</li>
      </ul>
    </details>
  );
}
