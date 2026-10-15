"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createConnectivity, guardedFetch, makeProbe, type Connectivity, type NetSnapshot } from "./connectivity";

// One shared connectivity monitor per browser tab. Created lazily on the client; the server (and tests) get a calm "online" snapshot.
const SERVER_SNAPSHOT: NetSnapshot = { status: "online", checking: false, since: 0, recovery: null, nextRetryAt: null, failures: 0 };

let monitor: Connectivity | null = null;
let installed = false;

export function getConnectivity(): Connectivity | null {
  if (typeof window === "undefined") return null;
  if (!monitor) {
    const realFetch = window.fetch.bind(window);
    monitor = createConnectivity({
      probe: makeProbe(realFetch),
      now: () => Date.now(),
      browserOnline: () => navigator.onLine,
      pageVisible: () => document.visibilityState !== "hidden",
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id as number),
      random: Math.random,
    });
    // Same-origin /api calls now fail at once, with a plain message, while the device is known to be offline.
    if (!installed) { window.fetch = guardedFetch(realFetch, monitor, window.location.origin); installed = true; }
  }
  return monitor;
}

/** Start the monitor and connect the browser's events to it. Mount once, high in the signed-in app. */
export function useConnectivityMonitor() {
  useEffect(() => {
    const c = getConnectivity();
    if (!c) return;
    c.start();
    const onOnline = () => c.browserOnline();
    const onOffline = () => c.browserOffline();
    const onVisible = () => { if (document.visibilityState === "visible") c.pageShown(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      c.stop();
    };
  }, []);
}

const subscribe = (fn: () => void) => getConnectivity()?.subscribe(fn) ?? (() => {});

/** The live connectivity state. */
export function useConnectivity(): NetSnapshot & { online: boolean; retryNow: () => void; acknowledgeRecovery: () => void } {
  const snap = useSyncExternalStore(subscribe, () => getConnectivity()?.getSnapshot() ?? SERVER_SNAPSHOT, () => SERVER_SNAPSHOT);
  return {
    ...snap,
    online: snap.status === "online",
    retryNow: () => { void getConnectivity()?.retryNow(); },
    acknowledgeRecovery: () => getConnectivity()?.acknowledgeRecovery(),
  };
}

/** For buttons that need the internet: `disabled={!online}` plus a reason to show next to it. */
export function useOnline(): boolean {
  return useConnectivity().online;
}
