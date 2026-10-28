"use client";

// "Now", "At arrival" (the default for stops) or "Pick a time": ONE choice for every place on the screen, with one line saying what it means.
// Picking a time uses a row of day buttons and a row of hour buttons (India time), never the phone's own time picker, and only within the
// 16 forecast days. A stop with no arrival time shows its whole day in "At arrival" (lib/forecast/day-summary.ts).
import { useState } from "react";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";
import { pickableDays, pickableHours, pickedInstant, type ViewMode } from "@/lib/forecast/view-time";
import { INDIA_UTC_OFFSET_MIN, clock12, dateOf } from "@/lib/travel/clock";

const dayLabel = (iso: string, today: string, tomorrow: string) =>
  iso === today ? "Today" : iso === tomorrow ? "Tomorrow" : new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
const hourLabel = (h: number) => clock12(`${String(h).padStart(2, "0")}:00`).replace(":00", "");

/** What each choice means, in one line. */
export const MODE_HELP: Record<ViewMode["kind"], string> = {
  now: "The weather at every place right now.",
  arrival: "Each stop at the time you will get there. A stop with no time shows its whole day.",
  picked: "Every place at the day and hour you picked.",
};

export function ViewModeSwitch({ mode, setMode, nowMs, horizonEnd }: { mode: ViewMode; setMode: (m: ViewMode) => void; nowMs: number; horizonEnd: number }) {
  const days = pickableDays(nowMs);
  const today = dateOf(nowMs, INDIA_UTC_OFFSET_MIN);
  const tomorrow = days[1] ?? "";
  const pickedDay = mode.kind === "picked" ? dateOf(mode.at, INDIA_UTC_OFFSET_MIN) : null;
  const [day, setDay] = useState<string>(pickedDay ?? today);
  const hours = pickableHours(day, nowMs, horizonEnd);
  const pickedHour = mode.kind === "picked" ? new Date(mode.at + INDIA_UTC_OFFSET_MIN * 60_000).getUTCHours() : null;

  const choose = (d: string, h: number) => { const at = pickedInstant(d, h, nowMs, horizonEnd); if (at !== null) setMode({ kind: "picked", at }); };
  const startPicking = () => { const h = pickableHours(today, nowMs, horizonEnd)[1] ?? pickableHours(today, nowMs, horizonEnd)[0]; setDay(today); if (h !== undefined) choose(today, h); };

  const seg = (on: boolean) => `inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-2xl px-1.5 text-[13px] font-extrabold transition-all sm:gap-1.5 sm:px-2 sm:text-sm ${on ? "bg-pine text-white shadow-lg" : "text-pine hover:bg-white"}`;
  const pill = (on: boolean) => `min-h-11 shrink-0 rounded-full border-2 px-3.5 text-sm font-bold transition-colors ${on ? "border-pine bg-pine text-white shadow" : "border-line bg-white text-pine hover:border-teal"}`;
  const item = (kind: ViewMode["kind"], label: string, icon: GlyphName, onClick: () => void) => (
    <button type="button" role="radio" aria-checked={mode.kind === kind} className={seg(mode.kind === kind)} onClick={onClick}><Glyph name={icon} size={15} className="shrink-0" />{label}</button>
  );
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Show the weather for" className="flex gap-1.5 rounded-3xl border-2 border-line bg-sky p-1.5">
        {item("now", "Now", "locate", () => setMode({ kind: "now" }))}
        {item("arrival", "At arrival", "navigate", () => setMode({ kind: "arrival" }))}
        {item("picked", "Pick a time", "calendar", () => (mode.kind === "picked" ? undefined : startPicking()))}
      </div>
      <p className="px-1 text-sm font-medium text-ink-muted" data-testid="mode-help">{MODE_HELP[mode.kind]}</p>
      {mode.kind === "picked" && (
        <div className="space-y-2 rounded-3xl border-2 border-line bg-white p-3" aria-label="Pick a day and an hour">
          <div role="group" aria-label="Day" className="relative flex gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <button key={d} type="button" aria-pressed={d === day} onClick={() => { setDay(d); const h = pickedHour !== null && pickableHours(d, nowMs, horizonEnd).includes(pickedHour) ? pickedHour : pickableHours(d, nowMs, horizonEnd)[0]; if (h !== undefined) choose(d, h); }} className={pill(d === day)}>
                {dayLabel(d, today, tomorrow)}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Hour" className="relative flex gap-2 overflow-x-auto pb-1">
            {hours.map((h) => (
              <button key={h} type="button" aria-pressed={pickedDay === day && pickedHour === h} onClick={() => choose(day, h)} className={`${pill(pickedDay === day && pickedHour === h)} min-w-12`}>
                {hourLabel(h)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setMode({ kind: "arrival" })} className="tm-action min-h-11 text-sm font-semibold">Back to arrival times</button>
        </div>
      )}
    </div>
  );
}
