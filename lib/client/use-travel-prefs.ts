"use client";

import { useCallback, useMemo } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";
import { parsePrefs, prefsKey, type TravelPrefs } from "@/lib/trip/preferences";

const EMPTY: Partial<TravelPrefs> = {};

/** This person's travel preferences, kept on THIS phone and changed only by them. */
export function useTravelPrefs(userId: string): { prefs: TravelPrefs; set: (patch: Partial<TravelPrefs>) => void } {
  const [stored, setStored] = useLocalJson<Partial<TravelPrefs>>(prefsKey(userId), EMPTY);
  const prefs = useMemo(() => parsePrefs(stored), [stored]);
  const set = useCallback((patch: Partial<TravelPrefs>) => setStored({ ...parsePrefs(stored), ...patch }), [setStored, stored]);
  return { prefs, set };
}
