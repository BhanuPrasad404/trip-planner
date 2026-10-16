import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Glyph } from "./Glyph";
import type { GlyphName } from "@/lib/glyphs";

// Small in-card actions ("Navigate", "Done", "Skip", "Add to ideas", "Why?") as modern pill buttons — the same everywhere.
// Plain underlined text is kept only for links INSIDE sentences (Terms, photo credits, sources), where that is the right style.
//   primary  the main action of a card (soft teal fill)
//   neutral  a normal action (outlined)
//   quiet    a small secondary action (no border until hovered)
//   danger   remove / delete (outlined, clay)
//   onDark   on a dark (pine) card
export type ActionTone = "primary" | "neutral" | "quiet" | "danger" | "onDark";

const TONES: Record<ActionTone, string> = {
  primary: "border-teal/30 bg-teal-light text-teal-ink hover:border-teal/60 hover:bg-teal/15",
  neutral: "border-line bg-white text-pine hover:border-teal/50 hover:bg-sky",
  quiet: "border-transparent bg-transparent text-ink-muted hover:bg-sky hover:text-pine",
  danger: "border-clay/30 bg-white text-clay-ink hover:border-clay/60 hover:bg-clay-light",
  onDark: "border-white/20 bg-white/10 text-white hover:bg-white/20",
};

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border font-semibold whitespace-nowrap transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
// "sm" stays 44 px tall on phones (an easy thumb target) and compact on larger screens.
const SIZES = { sm: "min-h-9 px-3 text-sm max-sm:min-h-11", xs: "min-h-8 px-2.5 text-xs max-sm:min-h-10" } as const;

export function actionClass(tone: ActionTone = "neutral", size: keyof typeof SIZES = "sm", extra = ""): string {
  return `${BASE} ${SIZES[size]} ${TONES[tone]} ${extra}`.trim();
}

type Common = { tone?: ActionTone; size?: keyof typeof SIZES; icon?: GlyphName; children: ReactNode };

export function ActionButton({ tone, size, icon, children, className = "", type = "button", ...props }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={actionClass(tone, size, className)} {...props}>
      {icon && <Glyph name={icon} size={size === "xs" ? 14 : 16} />}
      {children}
    </button>
  );
}

/** An action that opens another site (Google Maps, a website): always a new tab, said to screen readers. */
export function ActionLink({ tone, size, icon, children, className = "", ...props }: Common & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a target="_blank" rel="noopener noreferrer" className={actionClass(tone, size, className)} {...props}>
      {icon && <Glyph name={icon} size={size === "xs" ? 14 : 16} />}
      {children}
    </a>
  );
}
