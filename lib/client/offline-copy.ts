// The words on the offline strip, kept apart from the component so they can be tested and reviewed like the rest of our plain-language text.

/** How long "Back online" stays on screen. */
export const RECOVERY_SHOW_MS = 3_500;
/** After an outage at least this long, what the page shows may be out of date, so the page's data is fetched again. */
export const STALE_AFTER_MS = 20_000;
export const shouldRefreshAfter = (offlineMs: number): boolean => offlineMs >= STALE_AFTER_MS;

export function offlineCopy({ checking, secondsToRetry, failures }: { checking: boolean; secondsToRetry: number | null; failures: number }): { title: string; detail: string } {
  const detail = checking
    ? "Checking the connection…"
    : secondsToRetry !== null && secondsToRetry > 0
      ? `What's on screen is still here. Searching, importing and saving are paused. Trying again in ${secondsToRetry} s.`
      : "What's on screen is still here. Searching, importing and saving are paused until you're back online.";
  return { title: failures >= 4 ? "Still offline" : "You're offline", detail };
}

export function recoveryCopy(offlineMs: number): { title: string; detail: string } {
  return shouldRefreshAfter(offlineMs)
    ? { title: "Back online", detail: "Updating your trip with the latest changes…" }
    : { title: "Back online", detail: "" };
}
