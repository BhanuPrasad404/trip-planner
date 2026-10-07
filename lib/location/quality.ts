// Is this GPS reading good enough to act on? We never present a rough or old position as exact.
//   good     ≤ 50 m   — fine for "you are here" and for ETAs
//   fair     ≤ 150 m  — fine, drawn with its accuracy circle
//   rough    ≤ 1 km   — Wi-Fi/mobile-network position: shown, but not used for exact ETAs or shared with the group
//   poor     > 1 km   — usually IP-based (common on laptops): shown only as an approximate area
//   stale    older than STALE_MS
export type Fix = { lat: number; lng: number; accuracyM: number | null; fixAt: number; /** The traveller picked this place themselves (no GPS). */ manual?: boolean };
export type FixGrade = "good" | "fair" | "rough" | "poor" | "stale" | "unknown";

export const STALE_MS = 30_000;
export const GRADE_LIMITS_M = { good: 50, fair: 150, rough: 1_000 } as const;
/** Positions at or above this grade are used for ETAs, advice and sharing. */
export const USABLE: FixGrade[] = ["good", "fair"];

export type FixQuality = {
  grade: FixGrade;
  usable: boolean;
  /** Radius to draw around the dot (m); null when unknown. */
  radiusM: number | null;
  /** One honest sentence for the UI. */
  message: string;
  ageMs: number;
};

export function assessFix(fix: Fix | null, nowMs: number): FixQuality | null {
  if (!fix) return null;
  if (fix.manual) return { grade: "good", usable: true, radiusM: null, message: "This is the start point you chose, not a live GPS reading.", ageMs: 0 };
  const ageMs = Math.max(0, nowMs - fix.fixAt);
  const acc = fix.accuracyM;
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) {
    return { grade: "unknown", usable: false, radiusM: null, message: "We couldn't read a valid position.", ageMs };
  }
  if (ageMs > STALE_MS) return { grade: "stale", usable: false, radiusM: acc, message: `Your last position is ${Math.round(ageMs / 1000)} s old — waiting for a new one.`, ageMs };
  if (acc === null || !Number.isFinite(acc) || acc <= 0) return { grade: "unknown", usable: false, radiusM: null, message: "Your device didn't say how accurate this position is, so we treat it as approximate.", ageMs };
  if (acc <= GRADE_LIMITS_M.good) return { grade: "good", usable: true, radiusM: acc, message: `Accurate to about ${Math.round(acc)} m.`, ageMs };
  if (acc <= GRADE_LIMITS_M.fair) return { grade: "fair", usable: true, radiusM: acc, message: `Accurate to about ${Math.round(acc)} m.`, ageMs };
  if (acc <= GRADE_LIMITS_M.rough) return { grade: "rough", usable: false, radiusM: acc, message: `Rough position (±${Math.round(acc)} m). Move outdoors or turn on GPS for exact directions.`, ageMs };
  return { grade: "poor", usable: false, radiusM: acc, message: `Only an approximate area (±${acc >= 10_000 ? `${Math.round(acc / 1000)} km` : `${(acc / 1000).toFixed(1)} km`}) — this looks like a network position, not GPS.`, ageMs };
}

/** Map zoom that fits the uncertainty, so a rough fix is not shown as a street-level pin. */
export function zoomForAccuracy(accuracyM: number | null): number {
  if (accuracyM === null || accuracyM > 5_000) return 10;
  if (accuracyM > 1_000) return 11.5;
  if (accuracyM > 150) return 13;
  return 14;
}

/**
 * A device with real GPS reports about once a second; if that stops, the signal really is lost.
 * A laptop (Wi-Fi/IP positioning) only reports when its guess CHANGES — so silence is normal there. For those devices
 * we ask for a fresh reading ourselves instead of calling the signal "lost".
 */
export const POLL_AFTER_MS = 12_000;
export function shouldPollForFix(args: { nowMs: number; lastFixAtMs: number | null; accuracyM: number | null; manual: boolean }): boolean {
  if (args.manual) return false;
  if (args.lastFixAtMs !== null && args.nowMs - args.lastFixAtMs < POLL_AFTER_MS) return false; // updates are flowing
  const gpsGrade = args.accuracyM !== null && args.accuracyM > 0 && args.accuracyM <= GRADE_LIMITS_M.fair;
  return !gpsGrade; // no reading yet, or a coarse (network) one: ask again
}
