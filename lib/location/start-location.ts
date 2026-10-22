// "Use my current location" for the start field: every state in plain words, how sure the position is, and when a name we already
// have can be reused instead of asking the server again. Pure: no browser, no clock, no network (all passed in), so every case is tested.
import { distanceKm } from "@/lib/geo";

/** Reuse a name we already have while the phone is within this distance of where that name was looked up. */
export const RENAME_AFTER_KM = 1;
/** …and while the name is younger than this (towns don't move, but a phone may be carried to the same street weeks later). */
export const NAME_MAX_AGE_MS = 30 * 24 * 3_600_000;
/** Say "still looking" after this long, give up after this long. */
export const SLOW_AFTER_MS = 6_000;
export const GIVE_UP_AFTER_MS = 20_000;

export type Permission = "granted" | "denied" | "prompt" | "unknown";

export type LocationProblem = "denied" | "unavailable" | "timeout" | "unsupported" | "insecure";

const ALLOW_ANDROID = "On Android (Chrome): tap the lock or settings icon next to the web address → Permissions → Location → Allow.";
const ALLOW_IPHONE = "On iPhone: Settings → Privacy & Security → Location Services → turn it on, then Safari Websites → While Using the App.";

/** One honest message per problem, and what to do about it. Typing the area always works, so every message says so. */
export function problemMessage(p: LocationProblem): { title: string; detail: string[] } {
  switch (p) {
    case "denied":
      return { title: "Location is blocked for this site", detail: [ALLOW_ANDROID, ALLOW_IPHONE, "Then tap “Use my current location” again, or just type your area."] };
    case "unavailable":
      return { title: "Your phone couldn't give a location", detail: ["Check that Location (GPS) is turned on and airplane mode is off, or type your area."] };
    case "timeout":
      return { title: "Finding you took too long", detail: ["This happens indoors. Try again near a window, or type your area."] };
    case "unsupported":
      return { title: "This browser can't share your location", detail: ["Type your area instead, or open Trailmate in Chrome or Safari."] };
    case "insecure":
      return { title: "Location only works on a secure (https) page", detail: ["Open the https address of Trailmate, or type your area."] };
  }
}

/** From a GeolocationPositionError code (1 denied, 2 unavailable, 3 timeout). */
export function problemFromCode(code: number): LocationProblem {
  return code === 1 ? "denied" : code === 3 ? "timeout" : "unavailable";
}

export type AccuracyLevel = "precise" | "approximate" | "rough" | "unknown";

/** How sure the phone is, in words. A start point only needs to be right to about a kilometre, so "approximate" is still fine to use. */
export function accuracyOf(accuracyM: number | null | undefined): { level: AccuracyLevel; text: string } {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) return { level: "unknown", text: "Your phone didn't say how accurate this is." };
  if (accuracyM <= 100) return { level: "precise", text: `Accurate to about ${Math.max(5, Math.round(accuracyM / 5) * 5)} m` };
  if (accuracyM <= 1500) return { level: "approximate", text: `Approximate (within about ${accuracyM < 1000 ? `${Math.round(accuracyM / 50) * 50} m` : `${(accuracyM / 1000).toFixed(1)} km`})` };
  return {
    level: "rough",
    text: `Rough area only (within about ${Math.round(accuracyM / 1000)} km): your phone gave a network position, not GPS. If the name below is wrong, type your area. If your phone asks for “Precise location”, allow it.`,
  };
}

export type StoredName = { lat: number; lng: number; name: string; area: string; at: number };

/** Can we use the name we already have for this position, without asking the server? */
export function reusableName(prev: StoredName | null, here: { lat: number; lng: number }, nowMs: number): StoredName | null {
  if (!prev || typeof prev.name !== "string" || !prev.name || !Number.isFinite(prev.lat) || !Number.isFinite(prev.lng) || !Number.isFinite(prev.at)) return null;
  if (nowMs - prev.at > NAME_MAX_AGE_MS || nowMs < prev.at) return null;
  return distanceKm(prev, here) <= RENAME_AFTER_KM ? prev : null;
}

/** Positions leave the phone (and are kept on it) rounded to about 100 m: enough to name an area, not to pinpoint a home. */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
