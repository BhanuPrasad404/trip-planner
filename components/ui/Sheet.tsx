"use client";

// The one panel every picker opens in: a bottom sheet on phones, a centred card on larger screens. It is drawn on the page's top layer
// (a portal), so no card, scroll box or animated parent can clip it or trap it. Escape and the backdrop close it, focus moves in and
// stays in, and goes back to the button that opened it; the page behind does not scroll.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { lockScroll } from "@/lib/client/scroll-lock";
import { Glyph } from "./Glyph";

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled])';
const noop = () => () => undefined;
const onClient = () => true;
const onServer = () => false;

export function PickerSheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const mounted = useSyncExternalStore(noop, onClient, onServer);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    if (!mounted) return;
    const before = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();
    const target = ref.current?.querySelector?.<HTMLElement>('[data-autofocus="true"]') ?? ref.current;
    target?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) { e.preventDefault(); return; }
      const a = items[0], z = items[items.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === a || at === ref.current)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && at === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); unlock(); before?.focus?.(); };
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 sm:items-center" onClick={() => close.current()} data-picker-sheet="">
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="tm-sheet-in flex max-h-[85dvh] w-full flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] text-ink shadow-2xl outline-none sm:max-w-sm sm:rounded-3xl sm:pb-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="font-display text-lg font-semibold text-pine">{title}</h2>
          <button type="button" onClick={() => close.current()} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-sky"><Glyph name="close" size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** The look of the button that opens a picker: the same size and border as every other field, with a small arrow. */
export const PICKER_BUTTON =
  "flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-left text-base text-ink " +
  "outline-none focus-visible:border-teal focus-visible:ring-2 focus-visible:ring-teal/40 disabled:bg-sky disabled:text-ink-soft aria-[invalid=true]:border-clay";
