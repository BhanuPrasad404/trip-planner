"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ROUTE_PROGRESS_MAX_MS, ROUTE_START_EVENT, shouldTrackNavigation } from "@/lib/client/route-progress";

/**
 * A thin bar at the very top while the next page loads. Clicking a link or button that changes page gets a visible answer in
 * the same instant — pages are rendered on the server, so without this the old page just sits there until the new one arrives.
 * It ends by itself when the address (path or query) changes; a safety timeout covers a navigation that never completes.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}?${search}`;
  const hereRef = useRef(here);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  useEffect(() => { hereRef.current = here; });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      setStartedAt(hereRef.current);
      clearTimeout(timer);
      timer = setTimeout(() => setStartedAt(null), ROUTE_PROGRESS_MAX_MS);
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const track = shouldTrackNavigation({
        href: a.href, current: window.location.href, target: a.getAttribute("target"), download: a.hasAttribute("download"),
        noProgress: a.hasAttribute("data-no-progress"), button: e.button, modifier: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey, defaultPrevented: e.defaultPrevented,
      });
      if (track) start();
    };
    document.addEventListener("click", onClick);
    window.addEventListener(ROUTE_START_EVENT, start);
    return () => { clearTimeout(timer); document.removeEventListener("click", onClick); window.removeEventListener(ROUTE_START_EVENT, start); };
  }, []);

  // Active while the address is still the one we started on; the moment it changes the bar is gone (no effect needed).
  if (startedAt === null || startedAt !== here) return null;
  return (
    <div role="progressbar" aria-label="Loading the next page" aria-busy="true" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 bg-transparent">
      <div className="tm-route-bar h-full w-[85%] rounded-r-full bg-marigold shadow-[0_0_8px_rgba(232,163,61,0.7)] [animation:tm-route-grow_8s_cubic-bezier(0.1,0.7,0.2,1)_both] motion-reduce:[animation:none]" />
    </div>
  );
}
