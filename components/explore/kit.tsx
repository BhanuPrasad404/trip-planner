"use client";

// The small pieces every Explore section shares, so the whole page looks and behaves as one: a one-line scrolling chip row (never ten
// wrapped rows on a phone), a segmented "how far" control, skeleton cards, and one calm notice. Theme tokens only (app/globals.css).
import { useId } from "react";

/** `dark` = on the deep pine surface (Best in month): the chosen chip is marigold, the others are frosted. */
export const pill = (on: boolean, dark = false) =>
  `inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition active:scale-[0.97] ${dark
    ? on ? "border-marigold bg-marigold text-ink" : "border-white/25 bg-white/10 text-white hover:bg-white/20"
    : on ? "border-pine bg-pine text-white" : "border-line bg-white text-ink-muted hover:border-teal hover:text-pine"}`;

/** A one-line row of chips that scrolls sideways (snap, no scrollbar) and bleeds to the screen edge inside a padded card. */
export function ChipRow({ label, children, bleed = "5" }: { label: string; children: React.ReactNode; /** The padding of the card it sits in, so the row can run to the screen edge. */ bleed?: "4" | "5" }) {
  return (
    <div role="group" aria-label={label} className={`relative flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start ${bleed === "4" ? "-mx-4 px-4" : "-mx-5 px-5 sm:-mx-6 sm:px-6"}`}>
      {children}
    </div>
  );
}

export function Segmented<V extends string | number>({ label, value, options, onChange, dark = false }: { dark?: boolean; label: string; value: V; options: readonly { value: V; label: string }[]; onChange: (v: V) => void }) {
  const id = useId();
  return (
    <div>
      <p id={id} className={`text-xs font-semibold uppercase tracking-wide ${dark ? "text-white/75" : "text-ink-muted"}`}>{label}</p>
      <div role="group" aria-labelledby={id} className={`mt-1 inline-flex w-full max-w-md rounded-full border p-1 ${dark ? "border-white/20 bg-white/10" : "border-line bg-sky"}`}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
            className={`min-h-10 flex-1 rounded-full px-3 text-sm font-semibold transition-colors ${o.value === value ? (dark ? "bg-marigold text-ink shadow-card" : "bg-pine text-white shadow-card") : dark ? "text-white/85 hover:text-white" : "text-ink-muted hover:text-pine"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PlaceSkeletons({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading places" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-3xl border border-line bg-white p-2">
          <div className="aspect-[16/10] animate-pulse rounded-2xl bg-sky motion-reduce:animate-none" />
          <div className="px-3 pb-3 pt-3"><div className="h-5 w-2/3 animate-pulse rounded bg-sky motion-reduce:animate-none" /><div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-sky motion-reduce:animate-none" /></div>
        </li>
      ))}
    </ul>
  );
}

export function SectionTitle({ eyebrow, title, children, dark = false }: { dark?: boolean; eyebrow?: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div>
      {eyebrow && <p className={`font-mono text-xs font-semibold uppercase tracking-widest ${dark ? "text-marigold" : "text-marigold-ink"}`}>{eyebrow}</p>}
      <h2 className={`mt-0.5 break-words font-display text-2xl font-semibold leading-tight sm:text-3xl ${dark ? "text-white" : "text-pine"}`}>{title}</h2>
      {children && <p className={`mt-1 max-w-2xl text-sm ${dark ? "text-white/80" : "text-ink-muted"}`}>{children}</p>}
    </div>
  );
}
