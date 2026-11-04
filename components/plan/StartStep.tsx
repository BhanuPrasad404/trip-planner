// The first screen of "plan a trip": what this does for you, how you want to begin, and ways to try it without typing anything.
// Plain presentational pieces: PlanFlow owns the state and decides what each choice does. Colours are theme tokens only.
import Link from "next/link";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";

export type StartMode = "paste" | "describe" | "manual";

const WAYS: { mode: StartMode; title: string; sub: string; tag: string; icon: GlyphName; tone: string }[] = [
  { mode: "paste", title: "I saw these places", sub: "Paste a reel caption or a list of names", tag: "Fastest", icon: "paste", tone: "bg-marigold text-pine" },
  { mode: "describe", title: "Describe my trip", sub: "“4 days from Hyderabad with friends, beaches and food”", tag: "Type or speak", icon: "wand", tone: "bg-teal text-[var(--tm-on-accent)]" },
  { mode: "manual", title: "Pick places myself", sub: "Search and add them one by one", tag: "Full control", icon: "search", tone: "bg-pine text-[var(--tm-on-accent)]" },
];

/** The opening panel: what this does for you, in three promises. Deep pine, with a hill line drawn from the theme colours. */
export function PlanHero() {
  const PROMISES: { icon: GlyphName; text: string }[] = [
    { icon: "roadGood", text: "Real road times, with a safety margin" },
    { icon: "sunset", text: "No driving after dark, unless you say so" },
    { icon: "calendar", text: "Opening hours and night halts in real towns" },
  ];
  return (
    <header data-dark-surface className="relative isolate overflow-hidden rounded-[2rem] bg-pine px-5 pb-6 pt-6 text-[var(--tm-on-accent)] shadow-float sm:px-7 sm:pb-8 sm:pt-8">
      <svg aria-hidden="true" viewBox="0 0 400 120" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 w-full opacity-40"><path d="M0 120V70c50-34 90-30 140-6 46-34 96-40 140-8 40-20 82-18 120 6v58z" fill="var(--teal)" /></svg>
      <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 -z-10 h-36 w-36 rounded-full bg-marigold/25" />
      <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-widest text-marigold"><Glyph name="sparkles" size={13} />Plan with TrailMate</p>
      <h1 id="h-start" className="mt-3 text-balance font-display text-3xl font-semibold leading-[1.1] sm:text-4xl">Saw some places? Let&apos;s make them a real trip.</h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-white/85">Tell us in your own words, in English, Telugu, Hindi, Tamil, Kannada or Marathi. We read it, check it against real roads, and hand you a day-by-day plan.</p>
      <ul className="mt-5 grid gap-2.5 sm:grid-cols-3">
        {PROMISES.map((p) => (
          <li key={p.text} className="flex items-center gap-2.5 rounded-2xl bg-white/10 px-3.5 py-3 text-sm font-semibold">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-marigold text-pine"><Glyph name={p.icon} size={17} /></span>
            <span className="min-w-0">{p.text}</span>
          </li>
        ))}
      </ul>
    </header>
  );
}

export function WaysIn({ onPick }: { onPick: (m: StartMode) => void }) {
  return (
    <section aria-labelledby="h-ways">
      <h2 id="h-ways" className="mb-2.5 text-sm font-bold uppercase tracking-wide text-ink-muted">How do you want to begin?</h2>
      <ul className="grid gap-3" aria-label="How do you want to begin?">
        {WAYS.map((w) => (
          <li key={w.mode}>
            <button type="button" onClick={() => onPick(w.mode)} className="group flex min-h-[5.25rem] w-full items-center gap-4 rounded-3xl border-2 border-line bg-white p-4 text-left shadow-card transition-[border-color,box-shadow,transform] hover:border-teal hover:shadow-float focus-visible:border-teal focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/25 active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100">
              <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${w.tone}`}><Glyph name={w.icon} size={26} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[17px] font-bold leading-tight text-pine">{w.title}</span>
                  <span className="rounded-full bg-teal-light px-2.5 py-0.5 text-[11px] font-bold text-teal-ink">{w.tag}</span>
                </span>
                <span className="mt-1 block break-words text-sm leading-snug text-ink-muted">{w.sub}</span>
              </span>
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky text-pine transition-colors group-hover:bg-teal group-hover:text-[var(--tm-on-accent)]"><Glyph name="arrow" size={18} /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FinishedPlans({ plans }: { plans: readonly { slug: string; title: string; blurb: string }[] }) {
  return (
    <section aria-labelledby="h-finished">
      <h2 id="h-finished" className="text-sm font-bold uppercase tracking-wide text-ink-muted">See a finished plan first</h2>
      <ul className="mt-2.5 grid gap-2.5">
        {plans.map((e) => (
          <li key={e.slug}>
            <Link href={`/plan/example/${e.slug}`} className="group flex min-h-[4.5rem] items-center gap-3.5 rounded-3xl border border-line bg-marigold-light/60 px-4 py-3 transition-colors hover:border-marigold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-marigold/30">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-marigold text-pine"><Glyph name="compass" size={21} /></span>
              <span className="min-w-0 flex-1"><span className="block break-words font-bold text-pine">{e.title}</span><span className="block text-sm text-ink-muted">{e.blurb}</span></span>
              <Glyph name="arrow" size={18} className="text-pine transition-transform motion-safe:group-hover:translate-x-0.5" />
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
      <ul className="mt-2.5 space-y-2.5">
        {examples.map((e) => (
          <li key={e.text}>
            <button type="button" onClick={() => onPick(e)} className="group flex w-full items-start gap-3 rounded-3xl border-2 border-dashed border-line bg-white/70 px-4 py-3.5 text-left transition-colors hover:border-teal hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/25">
              <span className="min-w-0 flex-1">
                <span className="mb-1.5 inline-block rounded-full bg-pine px-2.5 py-0.5 text-[11px] font-bold text-[var(--tm-on-accent)]">{e.lang}</span>
                <span className="block whitespace-pre-line break-words text-[15px] leading-snug text-ink">{e.text}</span>
              </span>
              <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-light px-3 py-1.5 text-sm font-bold text-teal-ink">Try it<Glyph name="arrow" size={14} /></span>
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
      <p className="text-sm font-bold text-pine">Add details with a tap</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Things to add to your description">
        {PROMPT_CHIPS.map((c) => {
          const used = have.includes(c.toLowerCase());
          return (
            <li key={c}>
              <button type="button" onClick={() => onAdd(c)} disabled={used} aria-pressed={used} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-semibold transition-colors disabled:cursor-default ${used ? "border-teal bg-teal text-[var(--tm-on-accent)]" : "border-line bg-white text-ink hover:border-teal"}`}>
                <Glyph name={used ? "check" : "plus"} size={13} />{c}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
