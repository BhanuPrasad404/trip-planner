"use client";

import { useEffect, useRef } from "react";
import { dateOfTripDay } from "@/lib/dates";
import { formatDate } from "@/lib/format";

type RouteThreadProps = {
  numDays: number;
  activeDay: number;
  onSelectDay: (day: number) => void;
  startDate?: string | null; // "YYYY-MM-DD" — shows weekday + date labels if provided
  stopCounts?: Record<number, number>;
};

// The signature day navigator. Scrolls horizontally so trips of any length stay usable on a phone.
export function RouteThread({ numDays, activeDay, onSelectDay, startDate, stopCounts = {} }: RouteThreadProps) {
  const days = Array.from({ length: numDays }, (_, i) => i + 1);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeDay]);

  function labels(day: number) {
    const date = dateOfTripDay(startDate, day);
    if (!date) return { short: `Day ${day}`, spoken: `Day ${day}` };
    return {
      short: formatDate(date, { weekday: "short" }),
      sub: formatDate(date, { day: "numeric", month: "short" }),
      spoken: `Day ${day}, ${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}`,
    };
  }

  return (
    <nav aria-label="Trip days" className="bg-pine">
      <div className="scroll-thin overflow-x-auto px-3 pb-4 pt-2 sm:px-5">
        <ul className="relative mx-auto flex w-max min-w-full items-start justify-between gap-1 sm:gap-2">
          {/* Dotted thread behind the day dots */}
          <li
            aria-hidden="true"
            className="pointer-events-none absolute left-6 right-6 top-[19px] h-[2px]"
            style={{
              backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.4) 0 6px, transparent 6px 12px)",
              backgroundSize: "12px 2px",
              backgroundRepeat: "repeat-x",
            }}
          />
          {days.map((day) => {
            const isActive = day === activeDay;
            const count = stopCounts[day] ?? 0;
            const l = labels(day);
            return (
              <li key={day} className="relative z-10 min-w-[3.75rem] flex-1">
                <button
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={isActive}
                  aria-label={`${l.spoken}, ${count} ${count === 1 ? "stop" : "stops"}`}
                  className="flex min-h-12 w-full flex-col items-center gap-1 rounded-xl px-1 py-1 outline-offset-0 hover:bg-white/5"
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full border-2 font-mono text-sm transition-colors ${
                      isActive
                        ? "border-marigold bg-marigold text-pine"
                        : count > 0
                          ? "border-white/60 bg-white/15 text-white"
                          : "border-white/30 bg-pine text-white/75"
                    }`}
                  >
                    {day}
                  </span>
                  <span className={`text-xs font-semibold ${isActive ? "text-white" : "text-white/80"}`}>
                    {l.short}
                  </span>
                  {l.sub && <span className="-mt-1 text-[11px] text-white/70">{l.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
