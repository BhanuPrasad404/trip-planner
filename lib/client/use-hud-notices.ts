"use client";

import { useCallback, useEffect, useState } from "react";
import { pruneDismissed, visibleNotices, type HudNotice } from "@/lib/map/notices";

/**
 * The live map's messages: prioritised, limited to what fits, dismissible, and self-clearing where that is safe (see lib/map/notices.ts).
 *   - a dismissal lasts while the problem lasts and is forgotten when the problem is gone, so a new occurrence is shown again;
 *   - only `info` messages with an `autoHideMs` hide themselves; critical and important ones never do.
 */
export function useHudNotices(list: readonly HudNotice[], max = 1) {
  const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
  const dismissed = pruneDismissed(raw, list.map((n) => n.id));
  if (dismissed !== raw) setRaw(dismissed); // adjusting state while rendering (React's documented pattern): settles in one extra pass
  const dismiss = useCallback((id: string) => setRaw((cur) => new Set(cur).add(id)), []);

  const timed = list.filter((n) => n.severity === "info" && n.autoHideMs && n.autoHideMs > 0);
  const key = timed.map((n) => `${n.id}:${n.autoHideMs}`).join("|");
  useEffect(() => {
    const timers = timed.map((n) => setTimeout(() => dismiss(n.id), n.autoHideMs));
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` describes exactly the timers that should be running
  }, [key, dismiss]);

  return { ...visibleNotices(list, dismissed, max), dismiss };
}
