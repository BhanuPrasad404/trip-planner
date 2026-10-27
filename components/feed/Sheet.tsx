"use client";

import { useEffect, useRef } from "react";
import { lockScroll } from "@/lib/client/scroll-lock";
import { CloseIcon } from "./icons";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet on phones, a centred card on larger screens. Escape and the backdrop close it; focus moves into it, stays inside while
 * it is open, and comes back; the page behind does not scroll.
 *
 * The close function is kept in a ref ON PURPOSE: parents pass a new function on every render, and an effect that depended on it
 * moved focus back to the sheet every time anything behind it changed (a like, the bell's count): typing in a comment box lost its cursor.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();
    const first = ref.current?.querySelector<HTMLElement>("textarea, input, select");           // a sheet with a text box opens ready to type
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); ref.current.focus(); return; }
      const a = items[0], z = items[items.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === a || at === ref.current)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && at === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); unlock(); before?.focus?.(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center" onClick={() => close.current()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="tm-sheet-in flex max-h-[88dvh] w-full flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] text-ink shadow-2xl outline-none sm:max-w-md sm:rounded-3xl sm:pb-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-pine">{title}</h2>
          <button type="button" onClick={() => close.current()} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-sky"><CloseIcon size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
