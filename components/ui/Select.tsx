"use client";

// Our own list picker instead of the browser's drop-down (which looks different on every phone, is cut off by cards, and is hard to
// tap). Same job as <select>: a value, a list of choices, a change. It opens in a sheet with big rows; the chosen row is ticked and
// scrolled into view; arrow keys, Home/End, Enter and Escape work; a hidden input keeps it working inside a <form>.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { firstEnabled, lastEnabled, stepIndex } from "@/lib/pickers";
import { Glyph } from "./Glyph";
import { PICKER_BUTTON, PickerSheet } from "./Sheet";

export type SelectOption<V extends string = string> = { value: V; label: string; hint?: string; disabled?: boolean };

type Props<V extends string> = {
  value: V;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  /** What the list is about: the sheet's title and the button's accessible name when no visible label points at it. */
  label: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  /** Shown on the button when nothing matches the value. */
  placeholder?: string;
  className?: string;
  "aria-describedby"?: string;
  /** Button text different from the row's label (e.g. a short form on the button, a long one in the list). */
  buttonText?: (o: SelectOption<V> | undefined) => string;
};

export function Select<V extends string>({ value, onChange, options, label, id, name, disabled, placeholder = "Choose", className = "", buttonText, ...aria }: Props<V>) {
  const auto = useId();
  const btnId = id ?? auto;
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const text = buttonText ? buttonText(current) : current?.label ?? placeholder;
  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        id={btnId} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-describedby={aria["aria-describedby"]}
        onClick={() => setOpen(true)} className={`${PICKER_BUTTON} ${className}`}
      >
        <span className={`min-w-0 truncate ${current ? "" : "text-ink-soft"}`}>{text}</span>
        <Glyph name="down" size={16} className="text-ink-muted" />
      </button>
      {open && <SelectSheet label={label} options={options} value={value} onPick={(v) => { setOpen(false); if (v !== value) onChange(v); }} onClose={() => setOpen(false)} />}
    </>
  );
}

function SelectSheet<V extends string>({ label, options, value, onPick, onClose }: { label: string; options: readonly SelectOption<V>[]; value: V; onPick: (v: V) => void; onClose: () => void }) {
  const disabled = useMemo(() => options.map((o) => !!o.disabled), [options]);
  const start = Math.max(0, options.findIndex((o) => o.value === value));
  const [active, setActive] = useState(disabled[start] ? firstEnabled(disabled) : start);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => stepIndex(disabled, i, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => stepIndex(disabled, i, -1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(firstEnabled(disabled)); }
    else if (e.key === "End") { e.preventDefault(); setActive(lastEnabled(disabled)); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!disabled[active]) onPick(options[active].value); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {          // type the first letters to jump
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o, i) => !disabled[i] && o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <PickerSheet title={label} onClose={onClose}>
      <ul ref={list} role="listbox" aria-label={label} aria-activedescendant={`opt-${active}`} tabIndex={0} data-autofocus="true" onKeyDown={onKeyDown} className="p-2 outline-none">
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <li
              key={o.value} id={`opt-${i}`} data-i={i} role="option" aria-selected={selected} aria-disabled={o.disabled || undefined}
              onClick={() => { if (!o.disabled) onPick(o.value); }} onMouseMove={() => { if (!o.disabled && active !== i) setActive(i); }}
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 ${o.disabled ? "cursor-not-allowed opacity-45" : i === active ? "bg-sky" : ""}`}
            >
              <span className="min-w-0">
                <span className={`block text-base ${selected ? "font-semibold text-pine" : "text-ink"}`}>{o.label}</span>
                {o.hint && <span className="block text-sm text-ink-muted">{o.hint}</span>}
              </span>
              {selected && <Glyph name="check" size={18} className="text-teal-ink" />}
            </li>
          );
        })}
      </ul>
    </PickerSheet>
  );
}
