import type { GoScore } from "@/lib/goscore";

const tones: Record<GoScore["tone"], string> = {
  great: "bg-teal-ink text-white",
  good: "bg-teal-light text-teal-ink",
  mixed: "bg-marigold-light text-[#7a4a00]",
  poor: "bg-clay-light text-clay-ink",
};

// Native <details> keeps this keyboard- and screen-reader-accessible with zero JS.
export function GoScoreBadge({ score, forDay }: { score: GoScore; forDay?: string }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full text-xs font-semibold [&::-webkit-details-marker]:hidden">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${tones[score.tone]}`}>
          <span className="font-mono text-sm">{score.score}</span>
          <span>Go score · {score.label}{forDay ? <span className="font-normal"> · for {forDay}</span> : null}</span>
        </span>
        <span className="text-ink-muted underline underline-offset-2 group-open:hidden">Why?</span>
        <span className="hidden text-ink-muted underline underline-offset-2 group-open:inline">Hide</span>
      </summary>
      <ul className="mt-2 space-y-1 rounded-xl bg-sky/70 px-3 py-2 text-sm text-ink-muted">
        {score.reasons.map((r) => (
          <li key={r}>• {r}</li>
        ))}
        <li className="pt-1 text-xs">{forDay ? `For ${forDay}. ` : ""}Estimate based on {score.basis.replace("+", " + ")} data — conditions can change.</li>
      </ul>
    </details>
  );
}
