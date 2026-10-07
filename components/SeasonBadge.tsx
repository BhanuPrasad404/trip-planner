import type { SeasonStatus } from "@/lib/types";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";

const styles: Record<SeasonStatus, { className: string; icon: GlyphName; label: string }> = {
  good: { className: "bg-teal-light text-teal-ink", icon: "check", label: "In season" },
  wrong_season: { className: "bg-clay-light text-clay-ink", icon: "warn", label: "Out of season" },
  unknown: { className: "bg-line text-ink-muted", icon: "info", label: "Season unknown" },
};

// Status is conveyed by text + icon, never colour alone.
export function SeasonBadge({ status }: { status: SeasonStatus }) {
  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s.className}`}
    >
      <Glyph name={s.icon} size={13} />
      {s.label}
    </span>
  );
}
