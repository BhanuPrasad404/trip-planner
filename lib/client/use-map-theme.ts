"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "@/lib/map/theme-config";

const KEY = "tm_map_theme";
const listeners = new Set<() => void>();
const read = (): ThemeId => {
  try {
    const saved = localStorage.getItem(KEY);
    if (isThemeId(saved)) return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
};

/** The traveller's map theme (Light / Dark / High contrast), remembered on this device and shared by every map on the page. */
export function useMapTheme(): [ThemeId, (t: ThemeId) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);
  const set = useCallback((t: ThemeId) => {
    try { localStorage.setItem(KEY, t); } catch { /* private mode: still applies for this visit through the listeners */ }
    listeners.forEach((l) => l());
  }, []);
  return [theme, set];
}
