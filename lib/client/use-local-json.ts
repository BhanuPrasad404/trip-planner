"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// A small piece of browser storage as React state: survives reloads, stays in step between tabs, and never crashes the page when the
// browser blocks storage (private mode, full disk): then it simply remembers for this visit only. Used for choices that belong to THIS
// device (dismissed alerts, what-if inputs); anything the whole trip group should see belongs in the database instead.
const listeners = new Set<() => void>();
// Used ONLY for keys the browser refused to store. (It used to shadow every key, so a value deleted from storage — sign-out, a deleted
// trip, another person's outbox on a shared phone — came back from this copy for the rest of the visit.)
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeRaw(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value); // blocked or full: remember it for this visit only
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}

/** Parse stored JSON on top of `fallback` (a stable object): anything missing or damaged falls back, it never throws. */
export function parseStored<T extends object>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...fallback, ...(parsed as Partial<T>) } : fallback;
  } catch { return fallback; }
}

export function useLocalJson<T extends object>(key: string, fallback: T): [T, (next: T | ((cur: T) => T)) => void] {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null); // the server (and first paint) always sees "nothing stored"
  const value = useMemo(() => parseStored(raw, fallback), [raw, fallback]);
  const set = useCallback((next: T | ((cur: T) => T)) => {
    const cur = parseStored(readRaw(key), fallback);
    writeRaw(key, JSON.stringify(typeof next === "function" ? (next as (c: T) => T)(cur) : next));
  }, [key, fallback]);
  return [value, set];
}
