"use client";

import Link from "next/link";
import type { Toast } from "@/lib/client/use-toasts";

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-full bg-pine px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
          <span>{t.text}</span>
          {t.undo && <button type="button" onClick={() => { t.undo?.(); onDismiss(t.id); }} className="min-h-8 text-marigold underline">Undo</button>}
          {t.link && <Link href={t.link.href} className="min-h-8 shrink-0 leading-8 text-marigold underline">{t.link.label}</Link>}
        </div>
      ))}
    </div>
  );
}
