"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// A small piece of browser storage as React state: survives reloads, stays in step between tabs, and never crashes the page when the
// browser blocks storage (private mode, full disk): then it simply remembers for this visit only. Used for choices that belong to THIS
// device (dismissed alerts, what-if inputs); anything the whole trip group should see belongs in the database instead.
const listeners = new Set<() => void>();
const memory = new Map<string, string>(); // used only when the browser refuses storage

function readRaw(key: string): string | null {
  try { return window.localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
}
function writeRaw(key: string, value: string) {
  memory.set(key, value);
  try { window.localStorage.setItem(key, value); } catch { /* blocked: the in-memory copy still works for this visit */ }
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
