import { createElement } from "react";
import { GLYPHS, KIND_GLYPH, CATEGORY_GLYPH, TONES, type GlyphName } from "@/lib/glyphs";

/** A crisp vector icon. Decorative by default (the text next to it says what it is). */
export function Glyph({ name, size = 18, strokeWidth = 2, className }: { name: GlyphName; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`shrink-0 ${className ?? ""}`}
    >
      {GLYPHS[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

type Entry = { glyph: GlyphName; tone: keyof typeof TONES };
const FALLBACK: Entry = { glyph: "pin", tone: "pine" };

/** Round coloured badge with the icon for a place kind (fuel, hospital, cafe, ...). */
export function KindBadge({ kind, size = 40, className }: { kind: string; size?: number; className?: string }) {
  return <Badge entry={KIND_GLYPH[kind] ?? FALLBACK} size={size} className={className} />;
}

/** Same, for a trip place category (waterfall, fort, temple, ...). */
export function CategoryBadge({ category, size = 40, className }: { category: string; size?: number; className?: string }) {
  return <Badge entry={CATEGORY_GLYPH[category] ?? FALLBACK} size={size} className={className} />;
}

function Badge({ entry, size, className }: { entry: Entry; size: number; className?: string }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={`inline-flex shrink-0 items-center justify-center rounded-xl ${TONES[entry.tone].cls} ${className ?? ""}`}>
      <Glyph name={entry.glyph} size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Small inline icon (no badge) for chips and buttons. */
export function KindGlyph({ kind, size = 16, className }: { kind: string; size?: number; className?: string }) {
  return <Glyph name={(KIND_GLYPH[kind] ?? FALLBACK).glyph} size={size} className={className} />;
}
export function CategoryGlyph({ category, size = 16, className }: { category: string; size?: number; className?: string }) {
  return <Glyph name={(CATEGORY_GLYPH[category] ?? FALLBACK).glyph} size={size} className={className} />;
}
