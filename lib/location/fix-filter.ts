// Which GPS readings may move the "you" marker, the group sharing, the ETA and the route? A browser can hand us a precise
// satellite fix and, a second later, a coarse Wi-Fi/mobile-network one a kilometre away — drawn as-is, the marker jumps and a
// wrong position is even shared with friends. This pure filter decides, reading by reading, what to trust:
//   • invalid coordinates, and readings OLDER than the one we already accepted (they arrive out of order) → ignored
//   • a much weaker reading right after a precise one → ignored, unless it persists (the GPS signal really is gone: then we show
//     the honest, rougher position instead of freezing on an old one)
//   • an impossible jump (≥300 m at over 250 km/h) → ignored once; if the new place persists it is accepted
// Nothing here reads the clock or the network.
import { haversineM } from "@/lib/geo";
import { isGpsJump } from "@/lib/map/navigation";
import { GRADE_LIMITS_M } from "./quality";

export type RawFix = { lat: number; lng: number; accuracyM: number | null; /** when we received it (ms) */ at: number; /** when the device says it measured it (ms) */ fixAt: number };
export type FilterState = { last: RawFix | null; weakStreak: number; weakSince: number | null; jumpStreak: number };
export type FixVerdict = { accept: boolean; reason: "ok" | "invalid" | "out-of-order" | "weaker-than-before" | "jump"; state: FilterState };

export const initialFilter = (): FilterState => ({ last: null, weakStreak: 0, weakSince: null, jumpStreak: 0 });

/** A precise reading counts as "recent" for this long; after that a rougher one is simply what we have. */
export const PRECISE_FOR_MS = 20_000;
/** A weaker reading must persist this many readings AND this long before we believe the signal is really gone. */
export const WEAK_ACCEPT = { readings: 3, ms: 6_000 } as const;
/** A reading must be this many times vaguer than the last precise one (and at least this vague) to count as "weaker". */
export const WEAKER = { factor: 3, minM: 300 } as const;

const validCoord = (f: RawFix) => Number.isFinite(f.lat) && Number.isFinite(f.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180
  // 0,0 with no accuracy is the classic "no position yet" placeholder, not a real place.
  && !(f.lat === 0 && f.lng === 0 && !(f.accuracyM !== null && f.accuracyM > 0));

export function filterFix(state: FilterState, next: RawFix): FixVerdict {
  if (!validCoord(next)) return { accept: false, reason: "invalid", state };
  const last = state.last;
  if (!last) return { accept: true, reason: "ok", state: { ...initialFilter(), last: next } };

  // Out of order: the device measured this BEFORE the one we already use.
  if (Number.isFinite(next.fixAt) && Number.isFinite(last.fixAt) && next.fixAt + 1_000 < last.fixAt) return { accept: false, reason: "out-of-order", state };

  // A network position replacing a recent satellite fix.
  const lastPrecise = last.accuracyM !== null && last.accuracyM > 0 && last.accuracyM <= GRADE_LIMITS_M.fair;
  const recent = next.at - last.at < PRECISE_FOR_MS;
  const nextAcc = next.accuracyM;
  const weaker = nextAcc === null || nextAcc > Math.max(WEAKER.minM, WEAKER.factor * (last.accuracyM ?? 0));
  if (lastPrecise && recent && weaker) {
    const streak = state.weakStreak + 1;
    const since = state.weakSince ?? next.at;
    if (streak >= WEAK_ACCEPT.readings && next.at - since >= WEAK_ACCEPT.ms) return { accept: true, reason: "ok", state: { ...initialFilter(), last: next } };
    return { accept: false, reason: "weaker-than-before", state: { ...state, weakStreak: streak, weakSince: since } };
  }

  // An impossible jump: ignore the first, accept it if the new place persists.
  if (isGpsJump({ lat: last.lat, lng: last.lng, at: last.at }, { lat: next.lat, lng: next.lng, at: next.at })) {
    const jumps = state.jumpStreak + 1;
    if (jumps < 2) return { accept: false, reason: "jump", state: { ...state, jumpStreak: jumps } };
  }
  return { accept: true, reason: "ok", state: { ...initialFilter(), last: next } };
}

/** Straight-line distance moved between two accepted fixes, for callers that need it. */
export const movedM = (a: RawFix, b: RawFix) => haversineM(a, b);
