import { groundReport, type GroundChip, type Tone } from "@/lib/feed/ground";
import type { FeedItemDTO } from "@/lib/feed/map";
import { PinIcon } from "./icons";

// The signature of this feed: every post says what the place was like, when, and how much to trust it. Tone is never colour alone:
// the words say it too (a warning chip carries a "!" mark, an old report says "At the time").
const CHIP: Record<Tone, string> = {
  good: "bg-teal-light text-teal-ink",
  warn: "bg-marigold-light text-marigold-ink",
  neutral: "bg-sky text-ink-muted",
};
const DOT = { green: "bg-teal", amber: "bg-marigold", grey: "bg-ink-muted" } as const;

function Chip({ chip }: { chip: GroundChip }) {
  return (
    <li className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold ${CHIP[chip.tone]}`}>
      {chip.tone === "warn" && <span aria-hidden="true" className="font-bold">!</span>}
      {chip.label}
      {chip.tone === "warn" && <span className="sr-only"> (take care)</span>}
    </li>
  );
}

/** The crowd as a three-step meter with the word beside it. */
export function CrowdMeter({ crowd }: { crowd: NonNullable<ReturnType<typeof groundReport>["crowd"]> }) {
  const fill = crowd.tone === "warn" ? "bg-clay" : crowd.tone === "good" ? "bg-teal" : "bg-ink-muted";
  return (
    <span className="inline-flex min-h-7 items-center gap-2 rounded-full bg-sky px-2.5 text-xs font-semibold text-ink">
      <span aria-hidden="true" className="flex items-end gap-0.5">
        {[1, 2, 3].map((n) => <span key={n} className={`w-1.5 rounded-sm ${n <= crowd.filled ? fill : "bg-line"}`} style={{ height: 6 + n * 3 }} />)}
      </span>
      {crowd.label}<span className="sr-only"> crowd</span>
    </span>
  );
}

export function GroundReportView({ item, variant = "card" }: { item: Pick<FeedItemDTO, "experience" | "freshness">; variant?: "card" | "page" }) {
  const g = groundReport(item);
  const noDetail = g.empty;
  return (
    <section aria-label="What the traveler reported" className="space-y-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[g.dot]} ${g.current ? "motion-safe:animate-pulse" : ""}`} />
          <span className={g.current ? "text-teal-ink" : ""}>{g.stamp}</span>
        </span>
        {g.atTheTime && <span>At the time of the post, conditions may have changed</span>}
      </p>

      {noDetail ? (
        variant === "page" ? <p className="text-sm text-ink-muted">The traveler didn&apos;t add conditions or a tip to this post.</p> : null
      ) : (
        <>
          {(g.crowd || g.chips.length > 0 || g.fromArea) && (
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Conditions">
              {g.crowd && <li className="list-none"><CrowdMeter crowd={g.crowd} /></li>}
              {g.chips.slice(0, variant === "card" ? 5 : 12).map((c) => <Chip key={`${c.kind}-${c.id}`} chip={c} />)}
              {g.fromArea && (
                <li className="inline-flex min-h-7 items-center gap-1 rounded-full bg-teal-light px-2.5 text-xs font-semibold text-teal-ink" title="The traveler's phone was near this destination when they posted. This can't be proven, so it's a hint, not a guarantee.">
                  <PinIcon size={12} />Posted from the area
                </li>
              )}
            </ul>
          )}
          {g.tip && (
            <p className="rounded-xl border-l-4 border-teal bg-sky px-3 py-2 text-sm leading-snug text-ink"><strong className="font-semibold text-pine">Tip: </strong>{g.tip}</p>
          )}
        </>
      )}
    </section>
  );
}
