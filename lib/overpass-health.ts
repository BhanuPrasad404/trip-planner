// Remembers which Overpass servers are down, for every part of the app that asks them (Explore, nearby, tolls).
//
// Why: when the public servers refuse or never answer (seen for days from one address: 406/403/502/504 or no answer at all), every tap
// used to wait on each server in turn (about a minute) and then fail. Now a server that failed in an "outage" way is skipped for a few
// minutes, so the next tap fails (or falls back to saved places) at once instead of waiting again. After the pause it is tried again.
//
//   outage   (skip for OUTAGE_MS): no answer / network error, HTTP 403, 406, 5xx: waiting seconds will not fix these
//   busy     (skip for BUSY_MS):   HTTP 429 or a "too many requests" remark: usually passes in under a minute
//   anything else (HTTP 400, a bad question) says nothing about the server's health and is not remembered.
// Per server process only (a restart forgets): fine, because forgetting just means one slow try.

export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const OUTAGE_MS = 5 * 60_000;
export const BUSY_MS = 60_000;

type Down = { until: number; reason: string };
const down = new Map<string, Down>();

/** The servers to ask, in order: your own (OVERPASS_URL) first, then the public mirrors. */
export const overpassEndpoints = (): string[] => [...new Set([process.env.OVERPASS_URL, ...OVERPASS_MIRRORS].filter((u): u is string => !!u))];

export const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** How long a failure should keep a server out of turn, or 0 when the failure says nothing about the server (a bad question). */
export function pauseFor(failure: string): number {
  if (/HTTP 429|too many requests|rate_limited/i.test(failure)) return BUSY_MS;
  if (/HTTP (403|406|5\d\d)|TimeoutError|AbortError|timed out|out of memory|fetch failed|TypeError|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UND_ERR|network/i.test(failure)) return OUTAGE_MS;
  return 0;
}

/** Remember a failure ("HTTP 406", "TimeoutError", a remark...). */
export function noteOverpassFailure(url: string, failure: string, now: number = Date.now()): void {
  const ms = pauseFor(failure);
  if (ms > 0) down.set(hostOf(url), { until: now + ms, reason: failure.slice(0, 80) });
}

/** A real answer: the server is fine again. */
export function noteOverpassOk(url: string): void { down.delete(hostOf(url)); }

/** The endpoints not paused right now, and the reasons the others are paused (for the error message and the health page). */
export function usableOverpass(now: number = Date.now()): { usable: string[]; paused: { host: string; reason: string; forMs: number }[] } {
  const usable: string[] = [];
  const paused: { host: string; reason: string; forMs: number }[] = [];
  for (const url of overpassEndpoints()) {
    const d = down.get(hostOf(url));
    if (d && d.until > now) paused.push({ host: hostOf(url), reason: d.reason, forMs: d.until - now });
    else usable.push(url);
  }
  return { usable, paused };
}

/** "overpass-api.de -> HTTP 406 (paused 4 min)": the same shape as a live failure, so lib/explore/failure.ts reads both alike. */
export const pausedText = (p: { host: string; reason: string; forMs: number }) => `${p.host} -> ${p.reason} (paused ${Math.max(1, Math.round(p.forMs / 60_000))} min)`;

export const resetOverpassHealth = () => down.clear();
