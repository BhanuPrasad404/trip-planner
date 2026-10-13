"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ActionResult<R> = { ok: true; value: R } | { ok: false; error: string };

/**
 * One async user action (save, publish, create…), with the feedback rules in one place:
 *   • `pending` is true from the click until the REAL operation finishes — never faked, never artificially short or long
 *   • a second call while one is running is ignored and returns the SAME promise (no double submit, nothing sent twice)
 *   • a failure becomes `error` (the message from the thrown Error) and a `{ ok: false }` result; the caller's form state is
 *     never touched, so what the person typed is still there to retry
 *   • nothing updates after the component has gone away
 * Pair it with <Button loading={pending}>.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { fallbackError?: string } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<ActionResult<R>> | null>(null);
  const alive = useRef(true);
  const fnRef = useRef(fn);
  const fallback = opts.fallbackError ?? "Something went wrong. Please try again.";
  useEffect(() => { fnRef.current = fn; });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback((...args: A): Promise<ActionResult<R>> => {
    if (inFlight.current) return inFlight.current; // already running: the same operation, not a second one
    setPending(true);
    setError(null);
    const p: Promise<ActionResult<R>> = Promise.resolve()
      .then(() => fnRef.current(...args))
      .then((value): ActionResult<R> => ({ ok: true, value }), (e: unknown): ActionResult<R> => {
        const message = e instanceof Error && e.message ? e.message : fallback;
        if (alive.current) setError(message);
        return { ok: false, error: message };
      })
      .finally(() => { inFlight.current = null; if (alive.current) setPending(false); });
    inFlight.current = p;
    return p;
  }, [fallback]);

  const clearError = useCallback(() => setError(null), []);
  return { run, pending, error, clearError };
}
