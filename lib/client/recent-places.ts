"use client";

// Places this phone picked recently, offered first when a search box opens. Kept only on this phone, newest first, a few per kind of
// field. "My current location" is never kept here: a position stays on the phone only as the rounded, named one in use-current-place.
import type { PlaceKind } from "@/lib/places/types";

export type RecentPlace = { name: string; area: string; lat: number; lng: number; kind?: PlaceKind; at: number };
const KEY = (list: string) => `tm:recent-places:${list}:v1`;
export const MAX_RECENT = 6;

const valid = (p: unknown): p is RecentPlace => {
  const r = p as RecentPlace;
  return !!r && typeof r.name === "string" && r.name.length > 0 && Number.isFinite(r.lat) && Number.isFinite(r.lng) && Number.isFinite(r.at);
};

export function readRecent(list = "places"): RecentPlace[] {
  try {
    const raw = window.localStorage.getItem(KEY(list));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

/** Puts a place at the top (once: the same name at almost the same spot replaces the older entry). */
export function rememberRecent(place: Omit<RecentPlace, "at">, list = "places", now = Date.now()): RecentPlace[] {
  const same = (p: RecentPlace) => p.name.toLowerCase() === place.name.toLowerCase() && Math.abs(p.lat - place.lat) < 0.01 && Math.abs(p.lng - place.lng) < 0.01;
  const next = [{ ...place, at: now }, ...readRecent(list).filter((p) => !same(p))].slice(0, MAX_RECENT);
  try { window.localStorage.setItem(KEY(list), JSON.stringify(next)); } catch { /* storage blocked: nothing remembered */ }
  return next;
}
