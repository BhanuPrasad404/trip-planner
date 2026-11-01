// What an ACTIVE drive keeps on this phone, so it survives a reload, a closed tab or leaving the trip's pages. Pure: no React.
//
// Rules (the product rule, tested in tests/drive-persist.test.ts):
//   • one active drive per person on this phone: `tm:drive-active:<user>` names it; the drive itself is `tm:drive:<user>:<trip>`.
//     Another person signing in on the same phone sees nothing of it.
//   • it expires: after NO_GPS_EXPIRY_MS without a GPS reading (forgotten, phone left in a drawer), and after MAX_AGE_MS in any case.
//   • it is removed on Finish / Stop, on sign-out, when the trip is deleted or the person is removed from it.
//   • damaged or foreign data is ignored, never trusted, never throws.
// Only what is needed to carry on is kept: ids, names, the road lines and the screen's choices. No history of positions.
import type { NavRoute } from "@/lib/providers/types";
import type { DriveRoute } from "@/lib/client/use-drive";

/** Fired (on window) just before signing out: the drive stops, sharing ends while still signed in, and its data is wiped. */
export const DRIVE_SIGN_OUT_EVENT = "tm:signing-out";
/** Written on sign-out ("<user>:<time>") so OTHER tabs of this browser end the person's drive too (they get a storage event). */
export const DRIVE_SIGN_OUT_KEY = "tm:drive-signout";

export const NO_GPS_EXPIRY_MS = 3 * 3_600_000;
export const MAX_AGE_MS = 18 * 3_600_000;
/** Road lines are large; above this the drive is saved without them (they are fetched again at once). */
export const MAX_SNAPSHOT_CHARS = 450_000;

export const driveKey = (userId: string, tripId: string) => `tm:drive:${userId}:${tripId}`;
export const activeDriveKey = (userId: string) => `tm:drive-active:${userId}`;
/** Written by the tab that runs the drive as it unloads (a reload, or closed): see markHandoff. */
export const handoffKey = (userId: string) => `tm:drive-handoff:${userId}`;
/** Every per-person key a drive leaves behind (arrival memory, remembered targets, the drive itself). */
export const perUserDriveKeyPrefixes = (userId: string) => [`tm:drive:${userId}:`, `tm:drive-active:${userId}`, `tm:arrival:${userId}:`, `tm:nav-targets:${userId}:`, `tm:journey:${userId}:`, handoffKey(userId)];

export type Camera = { center: [number, number]; zoom: number; bearing: number; pitch: number };
export type DriveUi = { focusDay: number; follow: boolean; headingUp: boolean; showRadar: boolean; showAll: boolean; satellite: boolean; sheet: boolean | null; camera: Camera | null; page: "map" | "live" };
export type DriveSnapshot = {
  v: 1;
  userId: string;
  tripId: string;
  /** Shown on the "Driving to …" bar before the trip's data has loaded again. */
  tripName: string;
  savedAt: number;
  startedAt: number;
  /** When the last GPS reading was accepted (null: none yet). */
  lastFixAt: number | null;
  /** The drive's number: decisions made for THIS drive (the start check, alerts already given) stay valid across a reload. */
  session: number;
  confirmedSession: number | null;
  share: boolean;
  nav: { armed: boolean; targetId: string | null; route: NavRoute | null } | null;
  driveRoute: DriveRoute | null;
  /** Alerts already given in this drive ("approach:<stop>", "arrived:<stop>"): never repeated after a reload. */
  cued: string[];
  /** The next place, for the bar. */
  next: { id: string; name: string } | null;
  ui: DriveUi;
};

export const DEFAULT_UI: DriveUi = { focusDay: 1, follow: true, headingUp: true, showRadar: true, showAll: false, satellite: false, sheet: null, camera: null, page: "map" };

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isStr = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 200;
const isBool = (b: unknown): b is boolean => typeof b === "boolean";

/** A time this far ahead of the phone's clock is not believed (the clock was changed): the drive is treated as too old. */
export const FUTURE_SLACK_MS = 5 * 60_000;

/** Why a saved drive is not used (for the honest note on the screen), or null when it is still good. */
export function expiryReason(s: Pick<DriveSnapshot, "savedAt" | "startedAt" | "lastFixAt">, now: number): "no-gps" | "too-old" | null {
  if ([s.savedAt, s.startedAt, s.lastFixAt ?? s.startedAt].some((t) => t > now + FUTURE_SLACK_MS)) return "too-old";
  if (now - s.startedAt > MAX_AGE_MS || now - s.savedAt > MAX_AGE_MS) return "too-old";
  if (now - (s.lastFixAt ?? s.startedAt) > NO_GPS_EXPIRY_MS) return "no-gps";
  return null;
}

function parseCamera(c: unknown): Camera | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const center = o.center;
  if (!Array.isArray(center) || center.length !== 2 || !isNum(center[0]) || !isNum(center[1]) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 90) return null;
  if (!isNum(o.zoom) || o.zoom < 0 || o.zoom > 22 || !isNum(o.bearing) || !isNum(o.pitch) || o.pitch < 0 || o.pitch > 85) return null;
  return { center: [center[0], center[1]], zoom: o.zoom, bearing: o.bearing, pitch: o.pitch };
}

function parseUi(u: unknown): DriveUi {
  if (!u || typeof u !== "object") return DEFAULT_UI;
  const o = u as Record<string, unknown>;
  return {
    focusDay: isNum(o.focusDay) && Number.isInteger(o.focusDay) && o.focusDay >= 1 && o.focusDay <= 60 ? o.focusDay : DEFAULT_UI.focusDay,
    follow: isBool(o.follow) ? o.follow : DEFAULT_UI.follow,
    headingUp: isBool(o.headingUp) ? o.headingUp : DEFAULT_UI.headingUp,
    showRadar: isBool(o.showRadar) ? o.showRadar : DEFAULT_UI.showRadar,
    showAll: isBool(o.showAll) ? o.showAll : DEFAULT_UI.showAll,
    satellite: isBool(o.satellite) ? o.satellite : DEFAULT_UI.satellite,
    sheet: isBool(o.sheet) ? o.sheet : null,
    camera: parseCamera(o.camera),
    page: o.page === "live" ? "live" : "map",
  };
}

const isLine = (l: unknown): l is [number, number][] => Array.isArray(l) && l.length >= 2 && l.length <= 20_000 && l.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]));

/** Every field navigation reads from a step (lib/map/navigation.ts): a damaged or out-of-date saved step must not crash it. */
function validStep(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  const m = s.maneuver as Record<string, unknown> | null | undefined;
  return isNum(s.index) && typeof s.instruction === "string" && typeof s.name === "string" && (s.ref === null || typeof s.ref === "string") &&
    isNum(s.distanceM) && isNum(s.durationS) && isNum(s.startAlongM) && isNum(s.endAlongM) && s.endAlongM >= s.startAlongM &&
    !!m && typeof m === "object" && typeof m.type === "string";
}

function parseNavRoute(r: unknown): NavRoute | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Partial<NavRoute>;
  if (!isStr(o.id) || !isLine(o.line) || !Array.isArray(o.steps) || o.steps.length === 0 || o.steps.length > 2_000 || !isNum(o.distanceM) || !isNum(o.durationS)) return null;
  if (o.source !== "osrm") return null; // a straight line ("estimate") is never a route
  if (typeof o.via !== "string" || !o.steps.every(validStep)) return null;
  return r as NavRoute;
}

function parseDriveRoute(r: unknown): DriveRoute | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Partial<DriveRoute>;
  if (!Array.isArray(o.legs) || !Array.isArray(o.stopIds) || !o.stopIds.every(isStr) || !isNum(o.at) || (o.source !== "osrm" && o.source !== "estimate")) return null;
  if (!o.legs.every((l) => l && isNum(l.km) && isNum(l.minutes))) return null;
  if (!Array.isArray(o.line) || !o.line.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) return null;
  return r as DriveRoute;
}

/** A saved drive, if it is this person's, for this trip, intact and not expired. */
export function parseSnapshot(raw: string | null, want: { userId: string; tripId?: string }, now: number): DriveSnapshot | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1 || o.userId !== want.userId || !isStr(o.tripId) || (want.tripId !== undefined && o.tripId !== want.tripId)) return null;
  if (!isNum(o.savedAt) || !isNum(o.startedAt) || !(o.lastFixAt === null || isNum(o.lastFixAt)) || !isNum(o.session) || o.session < 1) return null;
  const snap: DriveSnapshot = {
    v: 1, userId: want.userId, tripId: o.tripId, tripName: isStr(o.tripName) ? o.tripName : "your trip",
    savedAt: o.savedAt, startedAt: o.startedAt, lastFixAt: o.lastFixAt as number | null, session: o.session,
    confirmedSession: isNum(o.confirmedSession) ? o.confirmedSession : null,
    share: isBool(o.share) ? o.share : true,
    nav: null, driveRoute: parseDriveRoute(o.driveRoute),
    cued: Array.isArray(o.cued) ? o.cued.filter((c): c is string => isStr(c)).slice(0, 200) : [],
    next: o.next && typeof o.next === "object" && isStr((o.next as Record<string, unknown>).id) && isStr((o.next as Record<string, unknown>).name) ? { id: (o.next as { id: string }).id, name: (o.next as { name: string }).name } : null,
    ui: parseUi(o.ui),
  };
  if (o.nav && typeof o.nav === "object") {
    const n = o.nav as Record<string, unknown>;
    snap.nav = { armed: n.armed === true, targetId: isStr(n.targetId) ? n.targetId : null, route: parseNavRoute(n.route) };
  }
  if (expiryReason(snap, now)) return null;
  return snap;
}

/** JSON to store. Too big (very long road lines): kept without the lines, which are fetched again. */
export function serializeSnapshot(s: DriveSnapshot): string {
  const full = JSON.stringify(s);
  if (full.length <= MAX_SNAPSHOT_CHARS) return full;
  return JSON.stringify({ ...s, driveRoute: null, nav: s.nav ? { ...s.nav, route: null } : null });
}

type Store = { length: number; key(i: number): string | null; getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

/** The person's active drive on this phone (which trip), if any. Expired or damaged ones are cleaned up. */
export function readActiveDrive(store: Store, userId: string, now: number): DriveSnapshot | null {
  try {
    const tripId = store.getItem(activeDriveKey(userId));
    if (!tripId) return null;
    const snap = parseSnapshot(store.getItem(driveKey(userId, tripId)), { userId, tripId }, now);
    if (!snap) clearDrive(store, userId, tripId);
    return snap;
  } catch {
    return null;
  }
}

/** Why the saved drive was dropped (to say so on the screen once), or null. Does not change storage. */
export function droppedReason(store: Store, userId: string, now: number): "no-gps" | "too-old" | null {
  try {
    const tripId = store.getItem(activeDriveKey(userId));
    if (!tripId) return null;
    const raw = store.getItem(driveKey(userId, tripId));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<DriveSnapshot>;
    if (o.userId !== userId || !isNum(o.savedAt) || !isNum(o.startedAt)) return null;
    return expiryReason({ savedAt: o.savedAt, startedAt: o.startedAt, lastFixAt: isNum(o.lastFixAt) ? o.lastFixAt : null }, now);
  } catch {
    return null;
  }
}

export function writeDrive(store: Store, s: DriveSnapshot): boolean {
  const put = (json: string) => { store.setItem(driveKey(s.userId, s.tripId), json); store.setItem(activeDriveKey(s.userId), s.tripId); };
  try {
    put(serializeSnapshot(s));
    return true;
  } catch {
    // Storage full: try again without the road lines (they are fetched again). If even that fails, an OLDER save must not be the one
    // that comes back after a reload, so it is removed: the drive still works, it just won't survive a reload.
    try {
      put(JSON.stringify({ ...s, driveRoute: null, nav: s.nav ? { ...s.nav, route: null } : null }));
      return true;
    } catch {
      try { store.removeItem(driveKey(s.userId, s.tripId)); if (store.getItem(activeDriveKey(s.userId)) === s.tripId) store.removeItem(activeDriveKey(s.userId)); } catch { /* blocked */ }
      return false;
    }
  }
}

/** The drive ended (Finish, Stop, trip gone): forget it. Only that trip's drive, and the active pointer if it points there. */
export function clearDrive(store: Store, userId: string, tripId: string) {
  try {
    store.removeItem(driveKey(userId, tripId));
    if (store.getItem(activeDriveKey(userId)) === tripId) store.removeItem(activeDriveKey(userId));
  } catch { /* blocked: nothing was saved */ }
}

/** Keys from before they were per person (`tm:arrival:<trip>`, `tm:nav-targets:<trip>`): no owner is known, so sign-out removes them. */
const LEGACY = /^tm:(arrival|nav-targets):[^:]+$/;

/** Signing out: everything this person's drives left on the phone (the next person must find nothing). Returns how many keys. */
export function clearUserDrives(store: Store, userId: string): number {
  const prefixes = perUserDriveKeyPrefixes(userId);
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && (prefixes.some((p) => k === p || k.startsWith(p)) || LEGACY.test(k))) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    return 0;
  }
  return doomed.length;
}

// ── Hand-off between tabs ──
// The tab running the drive releases its lock as it unloads. On a RELOAD it wants the drive back a moment later, but another open tab
// polling for the free lock could win that race and quietly take the drive from the tab the traveller is looking at. So the unloading
// tab leaves a short-lived note, and other tabs do not take over while it is fresh. A tab that was really CLOSED never comes back:
// the note goes stale and another tab takes over then.
export const HANDOFF_GRACE_MS = 12_000;

export function markHandoff(store: Store, userId: string, now: number) {
  try { store.setItem(handoffKey(userId), String(now)); } catch { /* blocked: other tabs simply take over sooner */ }
}

/** The tab that ran the drive unloaded within the grace period: let it come back first. A clock that jumped never extends the wait. */
export function handoffPending(store: Store, userId: string, now: number): boolean {
  try {
    const at = Number(store.getItem(handoffKey(userId)));
    return Number.isFinite(at) && at > 0 && Math.abs(now - at) < HANDOFF_GRACE_MS;
  } catch {
    return false;
  }
}

export function clearHandoff(store: Store, userId: string) {
  try { store.removeItem(handoffKey(userId)); } catch { /* blocked */ }
}

/** One drive at a time: may this trip start a drive now, or must the person first end the one on `activeTripId`? */
export const needsSwitch = (activeTripId: string | null, tripId: string) => activeTripId !== null && activeTripId !== tripId;
