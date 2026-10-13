"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Glyph } from "@/components/ui/Glyph";

/**
 * A proper dropdown menu: opens under its button on a laptop, and as a bottom sheet with a dimmed background on a phone
 * (big, thumb-friendly rows). Keyboard: Enter/Space open it, Arrow keys move, Home/End jump, Escape closes and returns focus to the
 * button, Tab closes. Clicking outside closes it. Screen readers get menu / menuitem roles.
 */
export function Menu({ label, children, trigger, triggerClassName, defaultOpen = false, title, onOpenChange }: {
  /** Accessible name of the button, e.g. "More actions for Kolanupaka". */
  label: string;
  /** Receives `close()` so an item can close the menu after it is chosen. */
  children: (close: () => void) => ReactNode;
  /** What the button shows. Default: a "more" (three dots) icon. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Open on first render (used by tests and screenshots). */
  defaultOpen?: boolean;
  /** Heading shown at the top of the sheet on phones. */
  title?: string;
  /** Told whenever the menu opens or closes (for example to reset a half-finished "are you sure?"). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(defaultOpen);
  const [refocus, setRefocus] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const latestOnOpenChange = useRef(onOpenChange);
  useEffect(() => { latestOnOpenChange.current = onOpenChange; });

  const setOpen = useCallback((next: boolean | ((o: boolean) => boolean)) => {
    setOpenState((cur) => {
      const v = typeof next === "function" ? next(cur) : next;
      if (v !== cur) queueMicrotask(() => latestOnOpenChange.current?.(v));
      return v;
    });
  }, []);
  /** Close; `giveFocusBack` returns the keyboard focus to the button (after Escape or choosing an item, not after a click elsewhere). */
  const close = useCallback((giveFocusBack = true) => { setRefocus(giveFocusBack); setOpen(false); }, [setOpen]);
  useEffect(() => { if (!open && refocus) button.current?.focus(); }, [open, refocus]);

  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();                                  // keyboard users land on the first choice
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setOpen]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName ?? "grid h-11 w-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-sky hover:text-pine aria-expanded:bg-sky aria-expanded:text-pine"}
      >
        {trigger ?? <MoreDots />}
      </button>
      {open && (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-40 bg-pine/40 sm:hidden" onClick={() => close(false)} />
          <div
            ref={panel}
            id={id}
            role="menu"
            aria-label={label}
            className="z-50 overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-xl max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:mb-[env(safe-area-inset-bottom)] max-sm:p-2 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-72"
          >
            {title && <p className="px-3 pb-1 pt-2 font-display text-base font-semibold text-pine sm:hidden">{title}</p>}
            {children(() => close())}
          </div>
        </>
      )}
    </div>
  );
}

function MoreDots() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** One row in a Menu. */
export function MenuItem({ icon, children, onSelect, tone = "default", disabled }: {
  icon?: Parameters<typeof Glyph>[0]["name"];
  children: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold transition-colors disabled:opacity-50 sm:min-h-11 ${
        tone === "danger" ? "text-clay-ink hover:bg-clay-light" : "text-pine hover:bg-sky"
      }`}
    >
      {icon && <Glyph name={icon} size={18} className={tone === "danger" ? "text-clay-ink" : "text-teal"} />}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** A small heading above a group of rows. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-ink-muted">{children}</p>;
}
