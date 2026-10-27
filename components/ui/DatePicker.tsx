"use client";

// Our own calendar instead of the browser's date box. One month at a time, whole weeks Monday to Sunday, days that are not allowed
// (before `min`, after `max`) greyed and not tappable, today ringed, the chosen day filled. The value is "YYYY-MM-DD" like the
// browser's, so nothing that reads it changes. Arrow keys move by a day / a week; Enter picks; Escape closes.
import { useEffect, useId, useRef, useState } from "react";
import { MONTHS, WEEKDAYS, longDate, monthAllowed, monthGrid, parseISO, shiftMonth, isoOf } from "@/lib/pickers";
import { Glyph } from "./Glyph";
import { PICKER_BUTTON, PickerSheet } from "./Sheet";

type Props = {
  value: string;
  onChange: (iso: string) => void;
  label: string;
  id?: string;
  min?: string | null;
  max?: string | null;
  /** Today in India, "YYYY-MM-DD". Passed in (not read here) so the screen and the tests agree on what today is. */
  today: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Show a "Today" shortcut under the grid when today is allowed. */
  showToday?: boolean;
};

export function DatePicker({ value, onChange, label, id, min, max, today, disabled, placeholder = "Choose a date", className = "", showToday = true }: Props) {
  const auto = useId();
  const [open, setOpen] = useState(false);
  const text = value ? longDate(value) : "";
  return (
    <>
      <button id={id ?? auto} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={`${PICKER_BUTTON} ${className}`}>
        <span className={`min-w-0 truncate ${text ? "" : "text-ink-soft"}`}>{text || placeholder}</span>
        <Glyph name="calendar" size={18} className="text-ink-muted" />
      </button>
      {open && <CalendarSheet label={label} value={value} min={min ?? null} max={max ?? null} today={today} showToday={showToday} onPick={(iso) => { setOpen(false); if (iso !== value) onChange(iso); }} onClose={() => setOpen(false)} />}
    </>
  );
}

function CalendarSheet({ label, value, min, max, today, showToday, onPick, onClose }: { label: string; value: string; min: string | null; max: string | null; today: string; showToday: boolean; onPick: (iso: string) => void; onClose: () => void }) {
  const base = parseISO(value) ?? parseISO(today) ?? { y: 2026, m: 1, d: 1 };
  const [view, setView] = useState({ y: base.y, m: base.m });
  const [focusIso, setFocusIso] = useState(value && parseISO(value) ? value : today);
  const grid = useRef<HTMLDivElement>(null);
  const bounds = { min, max };
  const weeks = monthGrid(view.y, view.m, bounds);
  const prev = shiftMonth(view.y, view.m, -1), next = shiftMonth(view.y, view.m, 1);
  const canPrev = monthAllowed(prev.y, prev.m, bounds), canNext = monthAllowed(next.y, next.m, bounds);

  useEffect(() => { grid.current?.querySelector<HTMLElement>(`[data-iso="${focusIso}"]`)?.focus({ preventScroll: true }); }, [focusIso, view]);

  const allowed = (iso: string) => !((min && iso < min) || (max && iso > max));
  const moveBy = (days: number) => {
    const p = parseISO(focusIso); if (!p) return;
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
    const iso = isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    if (!allowed(iso)) return;
    setFocusIso(iso); setView({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowLeft") { e.preventDefault(); moveBy(-1); } else if (k === "ArrowRight") { e.preventDefault(); moveBy(1); }
    else if (k === "ArrowUp") { e.preventDefault(); moveBy(-7); } else if (k === "ArrowDown") { e.preventDefault(); moveBy(7); }
  };

  const go = (m: { y: number; m: number }) => { setView(m); const f = isoOf(m.y, m.m, 1); setFocusIso(allowed(f) ? f : (min && f < min ? min : f)); };
  const todayOk = allowed(today);

  return (
    <PickerSheet title={label} onClose={onClose} footer={showToday && todayOk ? <button type="button" onClick={() => onPick(today)} className="tm-action min-h-11 w-full text-sm font-semibold">Today · {longDate(today)}</button> : undefined}>
      <div className="px-3 pb-3 pt-2">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => go(prev)} disabled={!canPrev} aria-label="Previous month" className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-sky disabled:opacity-30"><Glyph name="down" size={18} className="rotate-90" /></button>
          <p aria-live="polite" className="font-display text-base font-semibold text-pine">{MONTHS[view.m - 1]} {view.y}</p>
          <button type="button" onClick={() => go(next)} disabled={!canNext} aria-label="Next month" className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-sky disabled:opacity-30"><Glyph name="down" size={18} className="-rotate-90" /></button>
        </div>
        <div ref={grid} role="grid" aria-label={`${MONTHS[view.m - 1]} ${view.y}`} onKeyDown={onKeyDown} data-autofocus="true" tabIndex={-1} className="mt-1 outline-none">
          <div role="row" className="grid grid-cols-7 text-center text-xs font-semibold text-ink-muted">
            {WEEKDAYS.map((w) => <span key={w} role="columnheader" className="py-1.5">{w}</span>)}
          </div>
          {weeks.map((week, wi) => (
            <div role="row" key={wi} className="grid grid-cols-7">
              {week.map((d) => {
                const selected = d.iso === value, isToday = d.iso === today;
                return (
                  <button
                    key={d.iso} type="button" role="gridcell" data-iso={d.iso} disabled={d.disabled} aria-selected={selected} aria-current={isToday ? "date" : undefined}
                    aria-label={longDate(d.iso)} tabIndex={d.iso === focusIso ? 0 : -1} onClick={() => onPick(d.iso)}
                    className={`mx-auto my-0.5 flex h-11 w-11 items-center justify-center rounded-full text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-teal ${selected ? "bg-pine font-bold text-white" : d.disabled ? "text-ink-soft/50" : d.inMonth ? "text-ink hover:bg-sky" : "text-ink-muted hover:bg-sky"} ${isToday && !selected ? "ring-1 ring-marigold" : ""}`}
                  >
                    {d.day}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </PickerSheet>
  );
}
