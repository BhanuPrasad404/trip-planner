// The installable-app (PWA) pieces that are the same for everyone: names, colours and the app icon artwork.
// Nothing here is personal: the manifest and icons are public files, never built from a signed-in page or private data.
import type { ReactElement } from "react";

export const PWA_NAME = "Trailmate";
export const PWA_DESCRIPTION = "Group trip planner for India that knows when to go: season-aware stops, real driving times and live drive mode.";
export const PWA_THEME = "#faf8f3";       // the app's warm white (address bar / title bar): the same colour as the page
export const PWA_BACKGROUND = "#e8a33d";  // the phone's own splash while the app opens: the same marigold yellow as the in-app opening screen (components/ui/AppLoader.tsx)
export const PWA_TILE = "#e8a33d";        // the app icon's tile: the same marigold as the splash, so the icon melts into it (no square on the screen)
export const PWA_ICON_SIZES = { "192": 192, "512": 512, maskable: 512 } as const;
export type PwaIconKey = keyof typeof PWA_ICON_SIZES;
export const pwaIconPath = (key: PwaIconKey) => `/pwa-icon/${key}`;

/**
 * The Trailmate mark on the marigold tile: pine hills, a dotted trail and a cream sun. The tile is the SAME yellow as the phone's splash
 * background, so the installed app's opening screen is one full yellow field with the mark in the middle, not a square on a page.
 * `maskable`: Android crops icons to a circle or squircle; the mark is kept inside the central 60% "safe zone" so nothing is cut.
 */
export function pwaIconArt(size: number, maskable = false): ReactElement {
  const mark = Math.round(size * (maskable ? 0.6 : 0.74));
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: PWA_TILE }}>
      <svg width={mark} height={mark} viewBox="0 0 200 200">
        <circle cx="150" cy="52" r="21" fill="#FCF0DC" />
        <path d="M14 152 L74 76 L102 112 L138 54 L190 152 Z" fill="#0B3D3A" />
        {[[30, 172], [52, 176], [76, 175], [100, 170], [124, 168], [148, 171], [172, 166]].map(([x, y]) => <circle key={`${x}`} cx={x} cy={y} r="5.2" fill="#0B3D3A" />)}
      </svg>
    </div>
  );
}
