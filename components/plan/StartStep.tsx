// The first screen of "plan a trip": where you start, how you want to begin, and ways to try it without typing anything.
// Plain presentational pieces: PlanFlow owns the state and decides what each choice does.
import Link from "next/link";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";

export type StartMode = "paste" | "describe" | "manual";

const WAYS: { mode: StartMode; title: string; sub: string; tag: string; icon: GlyphName }[] = [
  { mode: "paste", title: "I saw these places", sub: "Paste a reel caption or a list of names", tag: "Fastest", icon: "paste" },
  { mode: "describe", title: "Describe my trip", sub: "“4 days from Hyderabad with friends, beaches and food”", tag: "Type or speak", icon: "wand" },
  { mode: "manual", title: "Pick places myself", sub: "Search and add them one by one", tag: "Full control", icon: "search" },
];

export function WaysIn({ onPick }: { onPick: (m: StartMode) => void }) {
  return (
    <ul className="grid gap-3" aria-label="How do you want to begin?">
      {WAYS.map((w) => (
        <li key={w.mode}>
          <button type="button" onClick={() => onPick(w.mode)} className="group flex min-h-[4.75rem] w-full items-center gap-3.5 rounded-2xl border border-line bg-white p-4 text-left shadow-sm transition-colors hover:border-teal focus-visible:border-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-light text-teal-ink"><Glyph name={w.icon} size={22} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-base font-bold text-pine">{w.title}</span>
                <span className="rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{w.tag}</span>
              </span>
              <span className="mt-0.5 block break-words text-sm text-ink-muted">{w.sub}</span>
            </span>
            <Glyph name="arrow" size={18} className="text-ink-muted transition-transform motion-safe:group-hover:translate-x-0.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FinishedPlans({ plans }: { plans: readonly { slug: string; title: string; blurb: string }[] }) {
  return (
    <section aria-labelledby="h-finished">
      <h2 id="h-finished" className="text-sm font-bold uppercase tracking-wide text-ink-muted">See a finished plan first</h2>
      <ul className="mt-2 grid gap-2">
        {plans.map((e) => (
          <li key={e.slug}>
            <Link href={`/plan/example/${e.slug}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 transition-colors hover:border-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marigold-light text-marigold-ink"><Glyph name="compass" size={19} /></span>
              <span className="min-w-0 flex-1"><span className="block break-words font-semibold text-pine">{e.title}</span><span className="block text-sm text-ink-muted">{e.blurb}</span></span>
              <Glyph name="arrow" size={16} className="text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TryExamples({ examples, onPick }: { examples: readonly { text: string; lang: string }[]; onPick: (e: { text: string; lang: string }) => void }) {
  return (
    <section aria-labelledby="h-examples">
      <h2 id="h-examples" className="text-sm font-bold uppercase tracking-wide text-ink-muted">Or try an example</h2>
      <p className="mt-0.5 text-sm text-ink-muted">Tap one to see how we read it. You can change everything after.</p>
      <ul className="mt-2 space-y-2">
        {examples.map((e) => (
          <li key={e.text}>
            <button type="button" onClick={() => onPick(e)} className="flex w-full items-start gap-3 rounded-2xl border border-dashed border-line bg-white/60 px-4 py-3 text-left transition-colors hover:border-teal hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40">
              <span className="min-w-0 flex-1">
                <span className="mb-1 inline-block rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{e.lang}</span>
                <span className="block whitespace-pre-line break-words text-sm text-ink">{e.text}</span>
              </span>
              <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-teal-ink">Try it<Glyph name="arrow" size={14} /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Things travellers usually say, one tap each: they are added to the text box, so the AI and our reader have more to work with. */
export const PROMPT_CHIPS = ["Weekend trip", "4 days", "With family", "With friends", "Beaches", "Hills and waterfalls", "Temples and forts", "Good food", "Relaxed pace", "No night driving"] as const;

export function PromptChips({ text, onAdd }: { text: string; onAdd: (phrase: string) => void }) {
  const have = text.toLowerCase();
  return (
    <div>
      <p className="text-sm font-semibold text-ink">Add details with a tap</p>
      <ul className="mt-1.5 flex flex-wrap gap-2" aria-label="Things to add to your description">
        {PROMPT_CHIPS.map((c) => {
          const used = have.includes(c.toLowerCase());
          return (
            <li key={c}>
              <button type="button" onClick={() => onAdd(c)} disabled={used} aria-pressed={used} className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold transition-colors disabled:cursor-default ${used ? "border-teal bg-teal-light/50 text-teal-ink" : "border-line bg-white text-ink hover:border-teal"}`}>
                <Glyph name={used ? "check" : "plus"} size={13} />{c}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
