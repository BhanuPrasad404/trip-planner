"use client";

import { useEffect, useRef, useState } from "react";
import { initialScroll, SCROLL_DEFAULTS, stepScroll, type ScrollState } from "./scroll-direction";

/**
 * True while the bottom navigation should be tucked away (the page is being read downwards). Follows the rules in scroll-direction.ts.
 *   - listens to the WINDOW's scroll only: a scrolling list inside the page (a sheet, a menu) does not fire it, so nested scrolling
 *     cannot hide the bar;
 *   - never hides when `enabled` is false (driving screens, an open menu), and shows the bar again on navigation to another page;
 *   - at most one update per animation frame.
 */
export function useHideOnScroll(enabled: boolean, resetKey: string): boolean {
  const [state, setState] = useState<{ key: string; hidden: boolean }>({ key: resetKey, hidden: false });
  const scroll = useRef<ScrollState>(initialScroll());

  useEffect(() => {
    if (!enabled) return;
    scroll.current = initialScroll(window.scrollY);
    let frame = 0;
    const read = () => {
      frame = 0;
      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const next = stepScroll(scroll.current, window.scrollY, { ...SCROLL_DEFAULTS, maxY });
      const changed = next.hidden !== scroll.current.hidden;
      scroll.current = next;
      if (changed) setState({ key: resetKey, hidden: next.hidden });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll); // rotation changes how far the page can scroll
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [enabled, resetKey]);

  return enabled && state.key === resetKey && state.hidden;
}
