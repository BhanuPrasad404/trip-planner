"use client";

import { useSyncExternalStore } from "react";

/** True while the screen matches a CSS media query (e.g. "(min-width: 1024px)"). False on the server and until the browser answers. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
