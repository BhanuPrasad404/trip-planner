"use client";

// "Now", "At arrival" (the default for stops) or "Pick a time": ONE choice for every place on the screen. Picking a time uses a row of
// day buttons and a row of hour buttons (India time), never the phone's own time picker, and only within the 16 forecast days.
import { useState } from "react";
import { pickableDays, pickableHours, pickedInstant, type ViewMode } from "@/lib/forecast/view-time";
import { INDIA_UTC_OFFSET_MIN, clock12, dateOf } from "@/lib/travel/clock";

const dayLabel = (iso: string, today: string, tomorrow: string) =>
  iso === today ? "Today" : iso === tomorrow ? "Tomorrow" : new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
const hourLabel = (h: number) => clock12(`${String(h).padStart(2, "0")}:00`).replace(":00", "");

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

  const seg = (on: boolean) => `min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold transition-colors ${on ? "bg-pine text-white shadow-sm" : "text-pine hover:bg-white"}`;
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Show the weather for" className="flex gap-1 rounded-xl border border-line bg-sky p-1">
        <button type="button" role="radio" aria-checked={mode.kind === "now"} className={seg(mode.kind === "now")} onClick={() => setMode({ kind: "now" })}>Now</button>
        <button type="button" role="radio" aria-checked={mode.kind === "arrival"} className={seg(mode.kind === "arrival")} onClick={() => setMode({ kind: "arrival" })}>At arrival</button>
        <button type="button" role="radio" aria-checked={mode.kind === "picked"} className={seg(mode.kind === "picked")} onClick={() => (mode.kind === "picked" ? undefined : startPicking())}>Pick a time</button>
      </div>
      {mode.kind === "picked" && (
        <div className="space-y-1.5 rounded-xl border border-line bg-white p-2" aria-label="Pick a day and an hour">
          <div role="group" aria-label="Day" className="flex gap-1.5 relative overflow-x-auto pb-1">
            {days.map((d) => (
              <button key={d} type="button" aria-pressed={d === day} onClick={() => { setDay(d); const h = pickedHour !== null && pickableHours(d, nowMs, horizonEnd).includes(pickedHour) ? pickedHour : pickableHours(d, nowMs, horizonEnd)[0]; if (h !== undefined) choose(d, h); }}
                className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold ${d === day ? "border-pine bg-pine text-white" : "border-line text-pine"}`}>
                {dayLabel(d, today, tomorrow)}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Hour" className="flex gap-1.5 relative overflow-x-auto pb-1">
            {hours.map((h) => (
              <button key={h} type="button" aria-pressed={pickedDay === day && pickedHour === h} onClick={() => choose(day, h)}
                className={`min-h-11 min-w-12 shrink-0 rounded-full border px-2.5 text-sm font-semibold ${pickedDay === day && pickedHour === h ? "border-pine bg-pine text-white" : "border-line text-pine"}`}>
                {hourLabel(h)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setMode({ kind: "arrival" })} className="min-h-11 text-sm font-semibold text-teal-ink underline underline-offset-2">Back to arrival times</button>
        </div>
      )}
    </div>
  );
}
