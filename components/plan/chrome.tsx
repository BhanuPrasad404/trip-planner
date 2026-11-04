// The frame pieces of the plan flow: the step tracker, the title block of a step, the card every group of fields sits on and the bottom
// action bar. Presentational only (PlanFlow owns every state). Every colour comes from the theme tokens in app/globals.css.
import type { ReactNode } from "react";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";

/** Numbered step tracker: done steps show a tick, the current one is filled, the rest are outlined. Words always say where you are. */
export function Stepper({ steps, at }: { steps: readonly { id: string; label: string }[]; at: number }) {
  const inset = 50 / steps.length;                       // the line runs from the middle of the first step to the middle of the last
  const done = steps.length > 1 ? (Math.max(0, at) / (steps.length - 1)) * (100 - 2 * inset) : 0;
  return (
    <nav aria-label="Steps" className="mb-5">
      <p className="mb-2 flex items-baseline justify-between text-xs font-bold uppercase tracking-widest text-ink-muted">
        <span>Step {Math.max(0, at) + 1} of {steps.length}</span>
        <span className="text-teal-ink">{steps[Math.max(0, at)]?.label}</span>
      </p>
      <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        <span aria-hidden="true" style={{ left: `${inset}%`, right: `${inset}%` }} className="absolute top-[1.05rem] h-1 rounded-full bg-line" />
        <span aria-hidden="true" style={{ left: `${inset}%`, width: `${done}%` }} className="absolute top-[1.05rem] h-1 rounded-full bg-teal transition-[width] duration-300 motion-reduce:transition-none" />
        {steps.map((s, i) => {
          const past = i < at, now = i === at;
          return (
            <li key={s.id} aria-current={now ? "step" : undefined} className="relative flex min-w-0 flex-col items-center gap-1.5">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${past ? "border-teal bg-teal text-[var(--tm-on-accent)]" : now ? "border-pine bg-pine text-[var(--tm-on-accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--teal)_22%,transparent)]" : "border-line bg-white text-ink-muted"}`}>
                {past ? <Glyph name="check" size={16} strokeWidth={3} /> : i + 1}
              </span>
              <span title={s.label} className={`block max-w-full truncate text-[11px] font-semibold ${now ? "text-pine" : "text-ink-muted"}`}>{s.label}{past ? <span className="sr-only"> (done)</span> : null}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The title of a step: a small coloured icon tile, the heading and one line that says what to do here. */
export function StepTitle({ id, icon, kicker, title, sub }: { id: string; icon: GlyphName; kicker?: string; title: string; sub?: ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pine text-[var(--tm-on-accent)] shadow-card"><Glyph name={icon} size={24} /></span>
      <div className="min-w-0">
        {kicker && <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-marigold">{kicker}</p>}
        <h1 id={id} className="text-balance font-display text-2xl font-semibold leading-tight text-pine sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-[15px] leading-relaxed text-ink-muted">{sub}</p>}
      </div>
    </div>
  );
}

/** A white card for a group of fields, with an optional small heading. */
export function PlanCard({ title, icon, children, className = "" }: { title?: string; icon?: GlyphName; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-line bg-white p-4 shadow-card sm:p-5 ${className}`}>
      {title && (
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-muted">
          {icon && <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-light text-teal-ink"><Glyph name={icon} size={15} /></span>}
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** Back and the main action, pinned to the bottom of the screen so the thumb never has to hunt for them. */
export function StepBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-6 border-t border-line bg-[var(--background)]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm sm:mx-0 sm:rounded-2xl sm:border">
      <div className="flex gap-3">{children}</div>
    </div>
  );
}
