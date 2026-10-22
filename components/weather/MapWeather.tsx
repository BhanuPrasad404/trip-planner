"use client";

// The weather on the Map screen, without hiding it in a closed panel:
//   • DRIVING and calm: nothing at all (the road needs the screen)
//   • DRIVING and something matters (Warning or Severe, next stop or road ahead, within 2 hours): ONE short line in the top stack,
//     "⚠ Warning · Golconda Fort 6:30 PM · heavy rain"; tap → the full weather panel over the map
//   • NOT driving: a small line always visible: calm, "Next: Golconda Fort 6 PM · 28° · Dry"; with an alert, that alert's line
// The line keeps its height while the forecast loads, so the map's controls do not jump.
import { useEffect } from "react";
import type { WeatherBoard } from "@/lib/client/use-weather-board";
import { isDriveAlert } from "@/lib/forecast/alerts";
import { SEVERITY_ICON, driveLineText, momentIcon, severityWord } from "@/lib/forecast/present";
import { INDIA_UTC_OFFSET_MIN, time12 } from "@/lib/travel/clock";
import { Glyph } from "@/components/ui/Glyph";
import { WeatherPanel, type WeatherPanelProps } from "./WeatherPanel";

const LEVEL_STYLE = { watch: "border-line bg-white text-pine", warning: "border-marigold bg-marigold-light text-[#7a4a00]", severe: "border-clay bg-clay-light text-clay-ink" } as const;

/** The one line. Returns null when there is nothing to say (driving and calm). */
export function MapWeatherLine({ board, driving, nowMs, onOpen }: { board: WeatherBoard; driving: boolean; nowMs: number; onOpen: () => void }) {
  const alert = driving ? board.alerts.find((a) => isDriveAlert(a, nowMs)) : board.alerts[0];
  if (alert) {
    return (
      <button type="button" onClick={onOpen} data-testid="map-weather-line" className={`flex min-h-11 w-full items-center gap-2 rounded-2xl border px-3 text-left text-sm font-semibold shadow-md ${LEVEL_STYLE[alert.level]}`}>
        <Glyph name={SEVERITY_ICON[alert.level]} size={18} strokeWidth={2.4} />
        <span className="shrink-0 uppercase tracking-wide">{severityWord(alert.level)}</span>
        <span className="min-w-0 flex-1 truncate">{driveLineText(alert)}</span>
        <Glyph name="up" size={14} />
      </button>
    );
  }
  if (driving) return null;
  // Not driving and calm: the next place to be, at its time.
  const next = board.places.find((p) => p.role === "stop") ?? board.places.find((p) => p.role === "here");
  const m = next?.moment?.status === "ok" ? next.moment : null;
  const text =
    board.status === "loading" || !next ? "Weather: getting the forecast…"
    : !m ? (next.moment?.status === "unavailable" ? "Weather unavailable right now" : `${next.name}: no forecast for that time`)
    : `${next.role === "stop" ? "Next" : "Here"}: ${next.name}${next.timing.status === "time" && next.timing.basis !== "now" ? ` ${time12(next.timing.at, INDIA_UTC_OFFSET_MIN)}` : ""} · ${m.tempC !== null ? `${Math.round(m.tempC)}°` : ""}${m.hazards.length === 0 && m.precipProb !== null && m.precipProb < 30 ? " · Dry" : m.precipProb !== null ? ` · ${Math.round(m.precipProb)}% rain` : ""}`;
  const icon = m ? momentIcon(m) : null;
  return (
    <button type="button" onClick={onOpen} data-testid="map-weather-line" className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-line bg-white/95 px-3 text-left text-sm font-semibold text-pine shadow-md">
      {icon ? <Glyph name={icon} size={18} className="text-marigold" /> : <Glyph name="cloud" size={18} className="text-ink-muted" />}
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <Glyph name="up" size={14} />
    </button>
  );
}

/** The full weather panel over the map (the map stays underneath). Escape or "Close" closes it. */
export function WeatherSheet({ open, onClose, panel }: { open: boolean; onClose: () => void; panel: WeatherPanelProps }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-pine/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Weather on your way" className="max-h-[88dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl bg-sky p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex justify-end">
          <button type="button" onClick={onClose} className="m-1 inline-flex min-h-11 items-center gap-1 rounded-full bg-white px-4 text-sm font-semibold text-pine shadow"><Glyph name="close" size={16} />Close</button>
        </div>
        <WeatherPanel {...panel} />
      </div>
    </div>
  );
}
