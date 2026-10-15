// The ONE way TrailMate talks to Wikipedia / Commons / Wikidata for photos.
//
// Wikimedia's API etiquette asks clients to identify themselves, make requests one after another rather than in a burst, and back
// off when told to. A client that fires ~20 parallel requests with an anonymous User-Agent gets throttled (429) and the photos
// silently vanish. So every call here is: allow-listed (no SSRF), spaced, retried with backoff + jitter (honouring Retry-After),
// and guarded by a circuit breaker so an outage costs one fast failure instead of a pile of slow ones.
//
// "null" always means "could not find out" — callers must NOT treat it as "no photo exists".

/** Parsed JSON, or null when the service could not be reached / answered badly. */
export type JsonGetter = (url: string) => Promise<unknown | null>;

const ALLOWED_HOSTS = new Set(["en.wikipedia.org", "commons.wikimedia.org", "www.wikidata.org"]);
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export type WikimediaStats = { calls: number; ok: number; retries: number; failures: number; rateLimited: number; skippedByBreaker: number; breakerTrips: number };

export type WikimediaOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** Requests in flight at once. Wikimedia prefers serial; 2 keeps pages quick without a burst. */
  maxConcurrent?: number;
  /** Minimum time between the START of two requests. */
  minGapMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Consecutive failed calls before the breaker opens, and how long it stays open. */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  userAgent?: () => string;
};

export type WikimediaClient = { getJson: JsonGetter; stats: () => WikimediaStats; breakerOpen: () => boolean };

/** Wikimedia asks for a contact address in the User-Agent. Set GEOCODER_USER_AGENT to e.g. "Trailmate/1.0 (https://your-site; you@example.com)". */
export const defaultUserAgent = () => process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)";

export const isAllowedWikimediaUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname) && u.port === "" && !u.username && !u.password;
  } catch { return false; }
};

export function createWikimediaClient(opts: WikimediaOptions = {}): WikimediaClient {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const maxConcurrent = Math.max(1, opts.maxConcurrent ?? 2);
  const minGapMs = opts.minGapMs ?? 120;
  const maxRetries = opts.maxRetries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 6_000;
  const threshold = opts.breakerThreshold ?? 5;
  const cooldown = opts.breakerCooldownMs ?? 60_000;
  const userAgent = opts.userAgent ?? defaultUserAgent;

  const s: WikimediaStats = { calls: 0, ok: 0, retries: 0, failures: 0, rateLimited: 0, skippedByBreaker: 0, breakerTrips: 0 };
  let active = 0;
  const waiting: (() => void)[] = [];
  let nextStart = 0;
  let consecutiveFailures = 0;
  let openUntil = 0;

  const acquire = () => new Promise<void>((resolve) => { if (active < maxConcurrent) { active++; resolve(); } else waiting.push(() => { active++; resolve(); }); });
  const release = () => { active--; waiting.shift()?.(); };
  const open = () => now() < openUntil;

  const fail = () => {
    s.failures++;
    if (++consecutiveFailures >= threshold) { openUntil = now() + cooldown; consecutiveFailures = 0; s.breakerTrips++; }
  };

  const backoff = (attempt: number, retryAfter: string | null) => {
    const secs = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(secs) && secs >= 0) return Math.min(5_000, secs * 1000); // honour the server, but never stall a page for long
    return Math.min(3_000, 400 * 2 ** attempt) * (0.5 + random() / 2);
  };

  async function once(url: string): Promise<{ json: unknown } | { retryAfter: string | null } | { dead: true }> {
    const wait = Math.max(0, nextStart - now());
    nextStart = Math.max(now(), nextStart) + minGapMs;
    if (wait > 0) await sleep(wait);
    s.calls++;
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": userAgent(), "Accept": "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return { json: await res.json() };
      if (res.status === 429) s.rateLimited++;
      if (RETRY_STATUS.has(res.status)) return { retryAfter: res.headers.get("retry-after") };
      return { dead: true }; // 403/404/400…: retrying cannot help
    } catch (e) {
      if (e instanceof SyntaxError) return { dead: true }; // an answer we cannot read
      return { retryAfter: null }; // timeout / network error
    }
  }

  const getJson: JsonGetter = async (url) => {
    if (!isAllowedWikimediaUrl(url)) return null;
    if (open()) { s.skippedByBreaker++; return null; }
    await acquire();
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const r = await once(url);
        if ("json" in r) { s.ok++; consecutiveFailures = 0; return r.json; }
        if ("dead" in r) break;
        if (attempt === maxRetries) break;
        s.retries++;
        await sleep(backoff(attempt, r.retryAfter));
      }
      fail();
      return null;
    } finally { release(); }
  };

  return { getJson, stats: () => ({ ...s }), breakerOpen: open };
}

/** The shared instance every photo lookup in this server process goes through. */
export const wikimedia = createWikimediaClient();
