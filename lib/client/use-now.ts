"use client";

import { useSyncExternalStore } from "react";

const subscribe = (onTick: () => void) => {
  const timer = setInterval(onTick, 30_000);
  return () => clearInterval(timer);
};

/** Current time in whole minutes since epoch, refreshed every 30 s. Returns 0 on the server (no clock mismatch). */
export function useNowMinute(): number {
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 60_000), () => 0);
}
