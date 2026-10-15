"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Full-screen ("immersive") mode for a screen region. The region itself is made `fixed inset-0` by the caller; this hook owns the parts
 * that must be undone reliably:
 *   - the page behind stops scrolling while it is open, and scrolls again when it closes or the page is left;
 *   - Escape closes it;
 *   - where the browser allows it (Android Chrome, desktop), the browser's own bars are hidden too. That is a bonus: the layout does
 *     not depend on it, and if the browser leaves full screen by itself (a system gesture) the in-page mode stays until closed.
 */
export function useImmersive() {
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    if (!immersive) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setImmersive(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = previous;
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, [immersive]);

  const enter = useCallback(() => {
    setImmersive(true);
    // Must be asked inside the tap itself; refused silently on browsers that do not allow it (iPhone Safari).
    try { void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined); } catch { /* not allowed here */ }
  }, []);
  const exit = useCallback(() => setImmersive(false), []);
  const toggle = useCallback(() => (immersive ? exit() : enter()), [immersive, enter, exit]);
  return { immersive, enter, exit, toggle };
}
