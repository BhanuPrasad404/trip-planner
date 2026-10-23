"use client";

import { Glyph } from "@/components/ui/Glyph";
import type { HudNotice } from "@/lib/map/notices";

const TONE: Record<HudNotice["severity"], string> = {
  critical: "border-clay/40 bg-clay-light text-clay-ink",
  important: "border-marigold/50 bg-marigold-light text-[#7a4a00]",
  info: "border-line bg-white text-pine",
};

/**
 * The few messages that fit on the map, one line or two each. Critical ones announce themselves assertively and are never hidden to make
 * room; the rest are polite. "N more" opens the route info sheet, where nothing that was moved off the map is lost.
 */
export function HudNotices({ shown, hiddenCount, onDismiss, onAction, onMore }: { shown: HudNotice[]; hiddenCount: number; onDismiss: (id: string) => void; onAction?: (id: string, actionId: string) => void; onMore?: () => void }) {
  if (shown.length === 0 && hiddenCount === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="hud-notices">
      {shown.map((n) => (
        <p key={n.id} role={n.severity === "critical" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-medium shadow ${TONE[n.severity]}`}>
          <span className="min-w-0 flex-1">{n.text}</span>
          {n.action && onAction && <button type="button" onClick={() => onAction(n.id, n.action!.id)} className="tm-action min-h-11 shrink-0 font-semibold">{n.action.label}</button>}
          {n.dismissible && <button type="button" onClick={() => onDismiss(n.id)} aria-label={`Dismiss: ${n.text}`} className="-my-1.5 -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted"><Glyph name="close" size={16} /></button>}
        </p>
      ))}
      {hiddenCount > 0 && onMore && <button type="button" onClick={onMore} className="min-h-11 rounded-full border border-line bg-white px-3 text-xs font-semibold text-pine shadow">{hiddenCount} more message{hiddenCount === 1 ? "" : "s"}</button>}
    </div>
  );
}
