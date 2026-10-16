// The installable-app (PWA) pieces that are the same for everyone: names, colours and the app icon artwork.
// Nothing here is personal: the manifest and icons are public files, never built from a signed-in page or private data.
import type { ReactElement } from "react";

export const PWA_NAME = "Trailmate";
export const PWA_DESCRIPTION = "Group trip planner for India that knows when to go: season-aware stops, real driving times and live drive mode.";
export const PWA_THEME = "#0b3d3a";      // the app's forest green (address bar / title bar)
export const PWA_BACKGROUND = "#06201c";  // the mobile theme's deep green (splash screen while the app opens)
export const PWA_ICON_SIZES = { "192": 192, "512": 512, maskable: 512 } as const;
export type PwaIconKey = keyof typeof PWA_ICON_SIZES;
export const pwaIconPath = (key: PwaIconKey) => `/pwa-icon/${key}`;

/**
 * The Trailmate mark (amber sun, green hills, dotted trail) on the forest-green tile.
 * `maskable`: Android crops icons to a circle or squircle; the mark is kept inside the central 60% "safe zone" so nothing is cut.
 */
export function pwaIconArt(size: number, maskable = false): ReactElement {
  const mark = Math.round(size * (maskable ? 0.6 : 0.78));
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: PWA_THEME }}>
      <svg width={mark} height={mark} viewBox="0 0 26 26">
        <circle cx="13" cy="13" r="13" fill="#E8A33D" />
        <path d="M5 18.5l4.6-6.2 2.6 3.2 3-5.4 5.8 8.4z" fill="#0B3D3A" />
        <path d="M6 20.5c3-1.2 6-.3 9-1.4 2-.7 3.6-.6 5-1.1" stroke="#0B3D3A" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="0.1 2.4" fill="none" />
      </svg>
    </div>
  );
}
