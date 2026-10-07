"use client";

import { Glyph } from "@/components/ui/Glyph";
import { THEMES, THEME_IDS, type ThemeId } from "@/lib/map/theme-config";

/** Light / Dark / High-contrast, switched instantly on the live map. */
export function MapThemeControl({ theme, onChange, satellite, onSatellite }: { theme: ThemeId; onChange: (t: ThemeId) => void; satellite?: boolean; onSatellite?: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full bg-white p-1 shadow-sm" role="group" aria-label="Map style">
      <Glyph name="layers" size={14} className="ml-2 text-ink-muted" />
      {THEME_IDS.map((id) => (
        <button key={id} type="button" aria-pressed={theme === id} onClick={() => onChange(id)} className={`min-h-8 rounded-full px-3 text-xs font-semibold ${theme === id ? "bg-pine text-white" : "text-ink-muted hover:bg-sky"}`}>{THEMES[id].label}</button>
      ))}
      {onSatellite && <button type="button" aria-pressed={!!satellite} onClick={() => onSatellite(!satellite)} className={`min-h-8 rounded-full px-3 text-xs font-semibold ${satellite ? "bg-pine text-white" : "text-ink-muted hover:bg-sky"}`}>Satellite</button>}
    </div>
  );
}
