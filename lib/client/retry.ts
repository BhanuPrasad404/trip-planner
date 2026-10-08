// Retry for flaky networks: a few attempts with growing pauses. Refusals ("too large", "too long", "sign in") are NOT retried —
// asking again would only produce the same answer, slower.
export class Fatal extends Error {}                         // throw this for "do not try again"

export type RetryOptions = { tries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> };

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const tries = o.tries ?? 3;
  const base = o.baseMs ?? 800;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fn(attempt); }
    catch (e) {
      last = e;
      if (e instanceof Fatal || attempt === tries) break;
      await sleep(base * 2 ** (attempt - 1));               // 0.8 s, 1.6 s, 3.2 s …
    }
  }
  throw last;
}

/** An HTTP status worth trying again: the server was busy or broken, not "no". */
export const transientStatus = (status: number) => status === 408 || status === 429 || status >= 500;
