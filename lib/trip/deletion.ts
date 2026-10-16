// Deleting a trip: small pure helpers shared by the server route, the owner's dialog and the members' "trip is gone" watcher.

/** The window event that tells this page's hooks (Drive mode) the trip no longer exists, so GPS and sharing stop at once. */
export const TRIP_GONE_EVENT = "tm:trip-gone";

/** Realtime broadcast channel the owner's app announces a deletion on. Only a HINT: listeners always re-check the database. */
export const tripStatusChannel = (tripId: string) => `trip-status-${tripId}`;
export const TRIP_DELETED_BROADCAST = "trip-deleted";
/** Someone left, was removed, or the trip changed owner. Listeners re-check: if the trip is now invisible, they were removed. */
export const MEMBERS_CHANGED_BROADCAST = "members-changed";

export const TRIP_DELETED_TITLE = "This trip was deleted by the owner";
export const TRIP_GONE_TITLE = "This trip is no longer available";
export const TRIP_REMOVED_TITLE = "You were removed from this trip";

/** Typing the trip name confirms the delete. Spaces and capital letters don't matter; the words do. */
export function tripNameMatches(typed: string, name: string): boolean {
  const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
  return norm(typed).length > 0 && norm(typed) === norm(name);
}

/**
 * A Supabase Storage URL → its bucket and object path, so the file can be removed. Only URLs on OUR Supabase project count;
 * anything else (another host, a malformed URL) returns null and is never touched.
 */
export function storageObjectFromUrl(fileUrl: string, supabaseUrl: string): { bucket: string; path: string } | null {
  let u: URL, base: URL;
  try {
    u = new URL(fileUrl);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (u.host !== base.host) return null;
  const m = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/.exec(u.pathname);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (path.split("/").some((seg) => seg === ".." || seg === "")) return null;
  return { bucket: m[1], path };
}

/** Groups storage objects by bucket (Storage removes per bucket). Duplicates are dropped. */
export function groupByBucket(objects: { bucket: string; path: string }[]): { bucket: string; paths: string[] }[] {
  const map = new Map<string, Set<string>>();
  for (const o of objects) {
    if (!map.has(o.bucket)) map.set(o.bucket, new Set());
    map.get(o.bucket)!.add(o.path);
  }
  return [...map].map(([bucket, paths]) => ({ bucket, paths: [...paths] }));
}

/**
 * Does a "does this trip still exist?" answer prove the trip is gone? Only a clean answer with no row does.
 * A network or server error proves nothing (the person may simply be offline in the ghats), so it never shows the "deleted" screen.
 */
export function provesTripGone(res: { data: unknown; error: unknown }): boolean {
  return !res.error && (res.data === null || res.data === undefined);
}

type KeyStore = { length: number; key(i: number): string | null; removeItem(k: string): void };

/** Remove everything this browser saved for one trip (visit queue, arrival memory, vehicle, dismissed cards…). */
export function forgetTripLocally(tripId: string, store?: KeyStore | null): number {
  let s: KeyStore | null | undefined = store;
  try {
    if (s === undefined) s = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return 0; // storage blocked: nothing was saved there either
  }
  if (!s) return 0;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith("tm:") && k.includes(tripId)) doomed.push(k);
    }
    for (const k of doomed) s.removeItem(k);
  } catch {
    return 0;
  }
  return doomed.length;
}

// The owner's own page must not show "deleted by the owner" to the owner in the moment between deleting and leaving.
const deletingHere = new Set<string>();
export const markDeletingHere = (tripId: string) => void deletingHere.add(tripId);
export const isDeletingHere = (tripId: string) => deletingHere.has(tripId);
export const unmarkDeletingHere = (tripId: string) => void deletingHere.delete(tripId);
