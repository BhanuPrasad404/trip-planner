// "Hotels near me" must mean near ME, and the app must always say what it searched around. Four different places must never be mixed up:
//   • where the device is NOW        • where the trip was PLANNED to start      • the next destination      • a place the traveller picked.
// Rules: a place the traveller picked always wins. Otherwise a fresh, reasonably precise device position. Otherwise we fall back, and say
// that we fell back (and why), and offer the traveller a way to choose.
export type CenterKind = "manual" | "device" | "next_stop" | "destination" | "planned_start";
export type SearchCenter = { lat: number; lng: number; label: string; kind: CenterKind; /** One sentence the screen can show: what we searched around and why. */ explanation: string; /** True when we are not searching where the traveller IS and they should be offered a choice. */ offerChoice: boolean };

export type CenterInput = {
  manual?: { lat: number; lng: number; label: string } | null;
  device?: { lat: number; lng: number; accuracyM: number | null; ageMs: number } | null;
  permission?: "granted" | "denied" | "prompt" | "unavailable" | "unknown";
  nextStop?: { lat: number; lng: number; label: string } | null;
  destination?: { lat: number; lng: number; label: string } | null;
  plannedStart?: { lat: number; lng: number; label: string } | null;
};

/** A position this old, or this vague, is not "where you are". */
export const MAX_DEVICE_AGE_MS = 5 * 60_000;
export const MAX_DEVICE_ACCURACY_M = 2_000;

export function chooseSearchCenter(i: CenterInput): SearchCenter | null {
  if (i.manual) return { ...i.manual, kind: "manual", explanation: `Searching around ${i.manual.label}, the place you chose.`, offerChoice: false };
  const d = i.device;
  const usable = d && d.ageMs <= MAX_DEVICE_AGE_MS && (d.accuracyM === null || d.accuracyM <= MAX_DEVICE_ACCURACY_M);
  if (d && usable) return { lat: d.lat, lng: d.lng, label: "where you are now", kind: "device", explanation: "Searching around your current location.", offerChoice: false };

  const why = !d
    ? i.permission === "denied" ? "Location is blocked" : i.permission === "unavailable" ? "Location isn't available" : "We don't have your location"
    : d.ageMs > MAX_DEVICE_AGE_MS ? "Your last position is out of date" : "Your position is too rough to search around";
  const fallback = i.nextStop ? { p: i.nextStop, kind: "next_stop" as const, what: "your next stop" } : i.destination ? { p: i.destination, kind: "destination" as const, what: "your destination" } : i.plannedStart ? { p: i.plannedStart, kind: "planned_start" as const, what: "where the trip was planned to start" } : null;
  if (!fallback) return null;
  return { lat: fallback.p.lat, lng: fallback.p.lng, label: fallback.p.label, kind: fallback.kind, explanation: `${why}, so we're searching around ${fallback.what} (${fallback.p.label}), not where you are. Choose a place if that's not what you want.`, offerChoice: true };
}
