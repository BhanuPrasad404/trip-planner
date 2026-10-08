"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";

/** A bottom sheet on phones, a centred card on larger screens. Escape and the backdrop close it; focus moves into it and comes back. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); before?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full flex-col rounded-t-3xl bg-white text-ink shadow-2xl outline-none sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-pine">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-sky"><CloseIcon size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
