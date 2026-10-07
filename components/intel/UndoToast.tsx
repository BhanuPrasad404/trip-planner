"use client";

import type { UndoState } from "@/lib/client/use-trip-actions";
import { Glyph } from "@/components/ui/Glyph";

/** After any change to the plan: what happened, and a one-tap way back. */
export function UndoToast({ undo, busy, onUndo, onDismiss }: { undo: UndoState | null; busy: boolean; onUndo: () => void; onDismiss: () => void }) {
  if (!undo) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-pine px-4 py-3 text-sm text-white shadow-lg md:bottom-6">
      <p className="min-w-0 flex-1 break-words">{undo.label}</p>
      <button type="button" onClick={onUndo} disabled={busy} className="min-h-10 shrink-0 rounded-lg bg-marigold px-3 font-bold text-pine disabled:opacity-60">{busy ? "Undoing…" : "Undo"}</button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="min-h-10 shrink-0 px-2 text-white/80"><Glyph name="close" size={18} /></button>
    </div>
  );
}
