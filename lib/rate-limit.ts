// A small sliding-window rate limiter behind an interface. This in-memory version is per server instance — enough to stop one
// client hammering an endpoint during development and early launch. When traffic justifies it, a Redis-backed RateLimiter
// drops in here and no route changes.
export interface RateLimiter {
  /** true = allowed (and counted), false = over the limit. */
  take(key: string, max: number, windowMs: number): boolean;
}

export function memoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = now();
  return {
    take(key, max, windowMs) {
      const t = now();
      if (t - lastSweep > 60_000) {            // keep memory bounded: forget keys that have gone quiet
        for (const [k, v] of hits) if (v.length === 0 || t - v[v.length - 1] > windowMs * 2) hits.delete(k);
        lastSweep = t;
      }
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}

export const rateLimiter: RateLimiter = memoryRateLimiter();
