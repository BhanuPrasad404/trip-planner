"use client";

// Our own time picker instead of the browser's time box: hour, minute and AM/PM as big tap targets. The value is "HH:mm" (24 h) like
// the browser's, so nothing that reads it changes. The minute list is every 5 minutes, and an odd saved minute (11:07) is kept and shown.
import { useId, useState } from "react";
import { clockText, from12, minuteChoices, to12, type Clock12 } from "@/lib/pickers";
import { Glyph } from "./Glyph";
import { PICKER_BUTTON, PickerSheet } from "./Sheet";

type Props = { value: string; onChange: (hhmm: string) => void; label: string; id?: string; disabled?: boolean; placeholder?: string; className?: string; /** Lets the person clear the time (optional fields). */ clearable?: boolean };

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const chip = (on: boolean) => `flex h-11 min-w-11 items-center justify-center rounded-xl px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-teal ${on ? "bg-pine font-bold text-white" : "bg-sky/60 text-ink hover:bg-sky"}`;

export function TimePicker({ value, onChange, label, id, disabled, placeholder = "Choose a time", className = "", clearable = false }: Props) {
  const auto = useId();
  const [open, setOpen] = useState(false);
  const text = clockText(value);
  return (
    <>
      <button id={id ?? auto} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={`${PICKER_BUTTON} ${className}`}>
        <span className={`min-w-0 truncate ${text ? "" : "text-ink-soft"}`}>{text || placeholder}</span>
        <Glyph name="down" size={16} className="text-ink-muted" />
      </button>
      {open && <TimeSheet label={label} value={value} clearable={clearable} onDone={(v) => { setOpen(false); if (v !== value) onChange(v); }} onClose={() => setOpen(false)} />}
    </>
  );
}

function TimeSheet({ label, value, clearable, onDone, onClose }: { label: string; value: string; clearable: boolean; onDone: (v: string) => void; onClose: () => void }) {
  const [t, setT] = useState<Clock12>(to12(value) ?? { hour: 9, minute: 0, pm: false });
  const pick = (patch: Partial<Clock12>) => setT((c) => ({ ...c, ...patch }));
  return (
    <PickerSheet
      title={label} onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {clearable && value && <button type="button" onClick={() => onDone("")} className="tm-action min-h-11 px-3 text-sm font-semibold">Clear</button>}
          <button type="button" onClick={() => onDone(from12(t))} className="ml-auto min-h-12 flex-1 rounded-xl bg-marigold px-5 font-bold text-pine">Set {clockText(from12(t))}</button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-ink-muted">Hour</legend>
          <div className="grid grid-cols-6 gap-1.5" data-autofocus="true" tabIndex={-1}>
            {HOURS.map((h) => <button key={h} type="button" aria-pressed={t.hour === h} onClick={() => pick({ hour: h })} className={chip(t.hour === h)}>{h}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-ink-muted">Minute</legend>
          <div className="grid grid-cols-6 gap-1.5">
            {minuteChoices(t.minute).map((m) => <button key={m} type="button" aria-pressed={t.minute === m} onClick={() => pick({ minute: m })} className={chip(t.minute === m)}>{String(m).padStart(2, "0")}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend className="sr-only">AM or PM</legend>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" aria-pressed={!t.pm} onClick={() => pick({ pm: false })} className={chip(!t.pm)}>AM</button>
            <button type="button" aria-pressed={t.pm} onClick={() => pick({ pm: true })} className={chip(t.pm)}>PM</button>
          </div>
        </fieldset>
      </div>
    </PickerSheet>
  );
}
