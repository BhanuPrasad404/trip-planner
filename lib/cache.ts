// One small, well-tested async cache for everything that talks to an outside service.
//  • fresh hit  → no network call
//  • same key already loading → everyone shares ONE call (request de-duplication)
//  • load fails → serve the last good value while it is still "usable" (stale-if-error), otherwise throw
//  • bounded size (least recently used goes first) so memory can't grow without limit
// Each data type picks its own TTL — weather, routes and places do not age at the same speed.

export type CacheStats = { name: string; size: number; hits: number; misses: number; deduped: number; staleServed: number; failures: number };

type Entry<T> = { value: T; at: number; ttl: number };
type Opts<T> = {
  name: string;
  max: number;
  /** How long a value counts as fresh. May depend on the value (e.g. a fallback estimate is kept only briefly). */
  ttlMs: number | ((value: T) => number);
  /** After a failed reload, how long an expired value may still be served. 0 = never. */
  staleMs?: number;
  now?: () => number;
};

const registry = new Set<AsyncCache<never>>();
export const allCacheStats = (): CacheStats[] => [...registry].map((c) => c.stats());

export class AsyncCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();
  private s = { hits: 0, misses: 0, deduped: 0, staleServed: 0, failures: 0 };
  private now: () => number;

  constructor(private opts: Opts<T>) {
    this.now = opts.now ?? Date.now;
    registry.add(this as unknown as AsyncCache<never>);
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && t - hit.at < hit.ttl) {
      this.entries.delete(key); this.entries.set(key, hit); // refresh recency
      this.s.hits++;
      return hit.value;
    }
    const running = this.inflight.get(key);
    if (running) { this.s.deduped++; return running; }

    this.s.misses++;
    const p = (async () => {
      try {
        const value = await load();
        const ttl = typeof this.opts.ttlMs === "function" ? this.opts.ttlMs(value) : this.opts.ttlMs;
        this.entries.delete(key);
        this.entries.set(key, { value, at: this.now(), ttl });
        while (this.entries.size > this.opts.max) this.entries.delete(this.entries.keys().next().value as string);
        return value;
      } catch (e) {
        this.s.failures++;
        if (hit && this.opts.staleMs && this.now() - hit.at < hit.ttl + this.opts.staleMs) { this.s.staleServed++; return hit.value; }
        throw e;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  clear() { this.entries.clear(); this.inflight.clear(); }
  stats(): CacheStats { return { name: this.opts.name, size: this.entries.size, ...this.s }; }
}
