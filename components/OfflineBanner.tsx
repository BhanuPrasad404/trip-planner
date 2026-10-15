"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnectivity, useConnectivityMonitor } from "@/lib/client/use-connectivity";
import { registerAlertWorker } from "@/lib/client/alert-channels";
import { recoveryCopy, offlineCopy, shouldRefreshAfter, RECOVERY_SHOW_MS } from "@/lib/client/offline-copy";

function WifiIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M2 8.8a15 15 0 0 1 20 0" className={off ? "motion-safe:animate-pulse" : ""} />
      <path d="M5.5 12.4a10 10 0 0 1 13 0" className={off ? "motion-safe:animate-pulse [animation-delay:150ms]" : ""} />
      <path d="M9 16a5 5 0 0 1 6 0" className={off ? "motion-safe:animate-pulse [animation-delay:300ms]" : ""} />
      <circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

/**
 * The connection status strip at the top of the signed-in app. It slides open when the device goes offline, tells the person what
 * still works and what is paused, retries by itself (and on request), and when the connection returns says so, refreshes the page's
 * data if the outage was long enough for it to have gone stale, then slides away. Honours "reduce motion".
 */
export function OfflineBanner() {
  useConnectivityMonitor();
  const net = useConnectivity();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const offline = net.status === "offline";
  // The service worker shows the friendly offline PAGE when a page cannot be opened with no connection. (It is also what phone
  // notifications need.) Registering it asks the person for nothing.
  useEffect(() => { void registerAlertWorker(); }, []);
  const recovered = !offline && net.recovery !== null;

  // Count down to the next automatic try while offline.
  useEffect(() => {
    if (!offline) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [offline]);

  // After an outage: refresh server data once if it was long enough to matter, show "Back online" briefly, then dismiss.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!recovered || !net.recovery || handled.current === net.recovery.at) return;
    handled.current = net.recovery.at;
    if (shouldRefreshAfter(net.recovery.offlineMs)) router.refresh();
    const id = window.setTimeout(() => net.acknowledgeRecovery(), RECOVERY_SHOW_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovered, net.recovery]);

  const open = offline || recovered;
  const copy = offline ? offlineCopy({ checking: net.checking, secondsToRetry: net.nextRetryAt ? Math.max(0, Math.ceil((net.nextRetryAt - now) / 1000)) : null, failures: net.failures }) : recovery(net.recovery);

  return (
    // The grid-rows trick animates height from 0 to its natural size without measuring anything.
    <div className={`sticky top-0 z-40 grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} data-offline-banner={open ? (offline ? "offline" : "recovered") : "hidden"}>
      <div className="overflow-hidden">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`flex items-center gap-3 px-4 py-2.5 text-sm sm:px-6 ${offline ? "bg-pine text-white" : "bg-teal text-white"} ${open ? "opacity-100" : "opacity-0"} transition-opacity duration-300 motion-reduce:transition-none`}
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <WifiIcon off={offline} />
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-tight">{copy.title}</p>
            {copy.detail && <p className="mt-0.5 text-[13px] leading-snug text-white/85">{copy.detail}</p>}
          </div>
          {offline && (
            <button
              type="button"
              onClick={net.retryNow}
              disabled={net.checking}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-white/15 px-3 text-[13px] font-bold text-white hover:bg-white/25 disabled:opacity-70"
            >
              {net.checking ? "Checking…" : "Try again"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function recovery(r: { offlineMs: number } | null) { return recoveryCopy(r?.offlineMs ?? 0); }
