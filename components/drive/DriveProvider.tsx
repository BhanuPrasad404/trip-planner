"use client";

// The app-wide home of the active drive. Rules (the product rule; tests/drive-provider.test.tsx):
//   • ONE drive at a time, per person, on this phone. Another trip's map and live screens can still be looked at; pressing Start there
//     asks first ("End your drive to A and start driving B?"). Nothing is ended without asking.
//   • the drive survives tab changes, page changes, back/forward and reloads (saved per person and per trip, with expiry).
//   • it ends on Finish / Stop, on sign-out (in any tab), when the trip is deleted or the person is removed, and after hours without GPS.
//   • on any other page a small "Driving to <stop>" bar takes the traveller back in one tap.
//   • only one browser tab runs it (lib/drive/lock.ts); another tab says where it runs, and takes over if that tab is closed (but not
//     while that tab is reloading: it gets its drive back).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DriveEngine, type Engine } from "./DriveEngine";
import { DriveBar } from "./DriveBar";
import { TripGoneWatcher } from "@/components/TripGoneWatcher";
import { loadTripData, type TripData } from "@/lib/client/trip-bundle";
import { acquireDriveLock } from "@/lib/drive/lock";
import {
  DRIVE_SIGN_OUT_EVENT, DRIVE_SIGN_OUT_KEY, clearDrive, clearHandoff, clearUserDrives, droppedReason, handoffPending, markHandoff, readActiveDrive,
  type DriveSnapshot,
} from "@/lib/drive/persist";
import { TRIP_GONE_EVENT } from "@/lib/trip/deletion";
import { createClient } from "@/lib/supabase/client";
import { fire } from "@/lib/client/fire";

type Engines = Record<string, Engine>;
type Store = { get: () => Engines; set: (tripId: string, e: Engine | null) => void; subscribe: (cb: () => void) => () => void };
function createStore(): Store {
  let value: Engines = {};
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (tripId, e) => {
      if (e) value = { ...value, [tripId]: e };
      else if (tripId in value) { const { [tripId]: _gone, ...rest } = value; void _gone; value = rest; }
      else return;
      subs.forEach((s) => s());
    },
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
}

export type ActiveDrive = { tripId: string; tripName: string; next: { id: string; name: string } | null; page: "map" | "live" };
type Registration = { tripId: string; data: TripData; refresh: () => void; page: "map" | "live" | null };
type Ctx = {
  userId: string | null;
  engines: Store;
  active: ActiveDrive | null;
  /** Another Trailmate tab on this phone is running the drive. */
  elsewhere: boolean;
  /** Driving, but the trip's data could not be loaded yet (offline): it is retried. */
  reconnecting: boolean;
  /** A short honest note about a drive that ended by itself ("ended after 3 hours without GPS"). */
  note: string | null;
  clearNote: () => void;
  register: (r: Registration) => void;
  unregister: (tripId: string) => void;
  /** End the active drive. */
  endActive: () => void;
};

const DriveCtx = createContext<Ctx | null>(null);
const nullStore = createStore();

export const NOTE_NO_GPS = "Your drive ended by itself: no GPS position for 3 hours.";
const TAKEOVER_EVERY_MS = 4_000;
const RETRY_MS = [3_000, 10_000, 30_000, 60_000];
const activeFrom = (s: DriveSnapshot): ActiveDrive => ({ tripId: s.tripId, tripName: s.tripName, next: s.next, page: s.ui.page });

export function DriveProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const engines = useRef(createStore()).current;
  const [registered, setRegistered] = useState<Registration | null>(null);
  const [cache, setCache] = useState<Record<string, TripData>>({});
  const [active, setActive] = useState<ActiveDrive | null>(null);
  const [restore, setRestore] = useState<{ snapshot: DriveSnapshot; resumeGps: boolean } | null>(null);
  /** The saved drive (if any) has been looked at: no engine starts before that, or it would start without its saved state. */
  const [checked, setChecked] = useState(false);
  /** This tab holds the drive's lock: only then may it save the drive (it never overwrites another tab's drive). */
  const [owner, setOwner] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);
  const [loadFailures, setLoadFailures] = useState<Record<string, number>>({});
  const [note, setNote] = useState<string | null>(null);
  const release = useRef<(() => void) | null>(null);
  const pendingLock = useRef<Promise<boolean> | null>(null);
  const activeRef = useRef(active);
  const registeredRef = useRef(registered);
  const elsewhereRef = useRef(elsewhere);
  useEffect(() => { activeRef.current = active; registeredRef.current = registered; elsewhereRef.current = elsewhere; });

  // ── The lock: one request at a time (React's development double-run must not make this tab fight itself). ──
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yielding = useRef<string | null>(null); // this tab stopped its own copy because another tab owns the drive: it is not "ended"
  const takeLock = useCallback((): Promise<boolean> => {
    if (!userId) return Promise.resolve(false);
    // A drive ended a moment ago and another starts in this tab (switching trips): keep the lock we still hold.
    if (releaseTimer.current) { clearTimeout(releaseTimer.current); releaseTimer.current = null; }
    if (release.current) { setOwner(true); return Promise.resolve(true); }
    pendingLock.current ??= acquireDriveLock(userId).then((r) => {
      pendingLock.current = null;
      if (!r) return false;
      release.current = r;
      setOwner(true);
      try { clearHandoff(window.localStorage, userId); } catch { /* storage blocked */ } // this tab is back (or took over): no one is owed a wait
      return true;
    });
    return pendingLock.current;
  }, [userId]);
  // Leaving the page (a reload, or the tab closed) while running the drive: other tabs wait a moment before taking over, so a reload
  // gets its own drive back (persist.ts, markHandoff).
  useEffect(() => {
    if (!userId) return;
    const onHide = () => {
      if (!release.current || !activeRef.current || yielding.current) return;
      try { markHandoff(window.localStorage, userId, Date.now()); } catch { /* storage blocked */ }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [userId]);
  // Released a little later, not at once: the browser frees a lock asynchronously, so a drive started right after another ended in
  // this tab would otherwise find the lock "taken" by itself. Another tab can take it as soon as it is really free.
  const dropLock = useCallback(() => {
    setOwner(false);
    if (!release.current || releaseTimer.current) return;
    releaseTimer.current = setTimeout(() => { releaseTimer.current = null; release.current?.(); release.current = null; }, 1_500);
  }, []);
  useEffect(() => () => { if (releaseTimer.current) clearTimeout(releaseTimer.current); release.current?.(); release.current = null; }, []);

  const readStore = useCallback((): Storage | null => { try { return window.localStorage; } catch { return null; } }, []);

  /** Carry on with the drive saved on this phone (after a reload, or when the tab that ran it was closed). */
  /** Resolves true when a saved drive was taken up (this tab now owns it). */
  const restoreSaved = useCallback(async (isCancelled: () => boolean): Promise<boolean> => {
    const store = readStore();
    if (!userId || !store) return false;
    const now = Date.now();
    if (droppedReason(store, userId, now) === "no-gps") setNote(NOTE_NO_GPS);
    const snap = readActiveDrive(store, userId, now);
    if (!snap) return false;
    if (!(await takeLock())) { if (!isCancelled()) { setElsewhere(true); setActive(activeFrom(snap)); } return false; }
    // Location already allowed: carry on following GPS at once. Otherwise one tap is needed (browsers only ask from a tap).
    let granted = false;
    try { granted = (await navigator.permissions?.query({ name: "geolocation" as PermissionName }))?.state === "granted"; } catch { granted = false; }
    if (isCancelled()) return true;
    yielding.current = null;
    setElsewhere(false);
    setRestore({ snapshot: snap, resumeGps: granted });
    setActive(activeFrom(snap));
    return true;
  }, [userId, takeLock, readStore]);

  useEffect(() => {
    let cancelled = false;
    void restoreSaved(() => cancelled).finally(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [restoreSaved]);

  // ── Another tab runs the drive: keep its name up to date, and take over when that tab is closed (its lock is released). ──
  useEffect(() => {
    if (!elsewhere || !userId) return;
    let cancelled = false;
    const onStorage = () => {
      const store = readStore();
      const snap = store ? readActiveDrive(store, userId, Date.now()) : null;
      setActive(snap ? activeFrom(snap) : null);
      if (!snap) setElsewhere(false); // that tab's drive ended: nothing to take over, and this tab is free to drive
    };
    const t = setInterval(() => {
      const store = readStore();
      if (store && handoffPending(store, userId, Date.now())) return; // that tab is reloading: let it take its drive back first
      void takeLock().then((ok) => {
        if (!ok || cancelled) return;
        // That tab is gone: this one may drive now, carrying on the saved drive. As after a reload, no engine starts before the saved
        // drive has been read (or it would start without it).
        setChecked(false);
        setElsewhere(false);
        yielding.current = null;
        void restoreSaved(() => false).then((restored) => { if (!restored) dropLock(); }).finally(() => setChecked(true));
      });
    }, TAKEOVER_EVERY_MS);
    window.addEventListener("storage", onStorage);
    return () => { cancelled = true; clearInterval(t); window.removeEventListener("storage", onStorage); };
  }, [elsewhere, userId, takeLock, restoreSaved, readStore, dropLock]);

  // ── Which trips get an engine: the drive (if this tab runs it), and the trip whose page is open (to look at, or to drive). ──
  const activeId = !elsewhere ? active?.tripId ?? null : null;
  const pageId = registered?.tripId ?? null;
  const dataFor = (id: string) => (registered?.tripId === id ? registered.data : cache[id]);

  // Driving while on another page (or after a reload that did not open the trip): load the trip's data in the browser, and keep
  // trying (with growing pauses, and at once when the connection is back) if it cannot be loaded.
  const loading = useRef(new Set<string>());
  const cacheRef = useRef(cache);
  useEffect(() => { cacheRef.current = cache; });
  const fetchData = useCallback(async (tripId: string) => {
    if (!userId || loading.current.has(tripId)) return;
    loading.current.add(tripId);
    const r = await loadTripData(tripId, userId, cacheRef.current[tripId] ?? null);
    loading.current.delete(tripId);
    if (r.ok) {
      setCache((c) => ({ ...c, [tripId]: r.data }));
      setLoadFailures((f) => { if (!(tripId in f)) return f; const { [tripId]: _ok, ...rest } = f; void _ok; return rest; });
    } else if (r.reason === "gone") window.dispatchEvent(new CustomEvent(TRIP_GONE_EVENT, { detail: { tripId } }));
    else setLoadFailures((f) => ({ ...f, [tripId]: (f[tripId] ?? 0) + 1 }));
  }, [userId]);
  const missing = activeId && checked && !dataFor(activeId) ? activeId : null;
  const failures = missing ? loadFailures[missing] ?? 0 : 0;
  useEffect(() => {
    if (!missing) return;
    if (failures === 0) { void fetchData(missing); return; }
    const t = setTimeout(() => void fetchData(missing), RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)]);
    const online = () => void fetchData(missing);
    window.addEventListener("online", online);
    return () => { clearTimeout(t); window.removeEventListener("online", online); };
  }, [missing, failures, fetchData]);

  /** The page's own refresh while it shows this trip (fresh server data, weather included); otherwise a browser fetch. Stable per trip. */
  const refreshers = useRef(new Map<string, () => void>());
  const fetchRef = useRef(fetchData);
  useEffect(() => { fetchRef.current = fetchData; });
  const refreshOf = (id: string) => {
    let f = refreshers.current.get(id);
    if (!f) {
      f = () => { const r = registeredRef.current; if (r && r.tripId === id) r.refresh(); else void fetchRef.current(id); };
      refreshers.current.set(id, f);
    }
    return f;
  };

  // ── Starting, giving way, ending ──
  const forget = useCallback((tripId: string) => {
    const store = readStore();
    if (userId && store) clearDrive(store, userId, tripId);
    setActive((a) => (a?.tripId === tripId ? null : a));
    setRestore((r) => (r?.snapshot.tripId === tripId ? null : r));
    dropLock();
  }, [userId, dropLock, readStore]);

  const onDriveStart = useCallback((tripId: string, tripName: string) => {
    yielding.current = null;
    setActive((a) => ({ tripId, tripName, next: a?.tripId === tripId ? a.next : null, page: a?.page ?? "map" }));
    // Until the lock answers this tab does not save anything, so it can never overwrite a drive another tab is running.
    void takeLock().then((ok) => {
      if (ok) return;
      yielding.current = tripId;
      const own = engines.get()[tripId];
      own?.live.drive.setShare(false, { keepRow: true }); // the location row belongs to the tab that owns the drive: leave it
      own?.live.drive.stop();
      const store = readStore();
      const snap = store && userId ? readActiveDrive(store, userId, Date.now()) : null;
      setElsewhere(true);
      setActive(snap ? activeFrom(snap) : null);
    });
  }, [takeLock, engines, readStore, userId]);

  const onDriveEnd = useCallback((tripId: string, why: "stopped" | "no-gps") => {
    if (yielding.current === tripId) return; // giving way to another tab: its drive must not be forgotten
    forget(tripId);
    if (why === "no-gps") setNote(NOTE_NO_GPS);
  }, [forget]);

  const endActive = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    const e = engines.get()[a.tripId];
    if (e?.live.drive.active) e.live.drive.stop();
    else forget(a.tripId); // paused, or not loaded yet: just forget it
  }, [engines, forget]);

  /** Start pressed on a trip that is NOT the one being driven: one drive at a time, so ask first (inside the tap, so it can start). */
  const guardStart = useCallback((tripId: string, tripName: string): boolean => {
    const a = activeRef.current;
    if (elsewhereRef.current) {
      window.alert(`Your drive${a ? ` (${a.tripName})` : ""} is running in another Trailmate tab. End it there first, or close that tab.`);
      return false;
    }
    if (!a || a.tripId === tripId) return true;
    if (!window.confirm(`You're driving ${a.tripName}${a.next ? ` (next: ${a.next.name})` : ""}. End that drive and start driving ${tripName}?`)) return false;
    endActive();
    return true;
  }, [endActive]);
  const guards = useRef(new Map<string, () => boolean>());
  const guardRef = useRef(guardStart);
  useEffect(() => { guardRef.current = guardStart; });
  const guardOf = (id: string, name: string) => {
    let f = guards.current.get(id);
    if (!f) { f = () => guardRef.current(id, name); guards.current.set(id, f); }
    return f;
  };

  // The bar shows where the drive goes next (kept in step with the engine).
  const valueSetters = useRef(new Map<string, (e: Engine | null) => void>());
  const onValueOf = (id: string) => {
    let f = valueSetters.current.get(id);
    if (!f) {
      f = (e: Engine | null) => {
        engines.set(id, e);
        const a = activeRef.current;
        if (!e || !a || a.tripId !== id) return;
        const next = e.live.nextTarget ? { id: e.live.nextTarget.id, name: e.live.nextTarget.name } : null;
        if (a.next?.id !== next?.id || a.next?.name !== next?.name || a.page !== e.ui.page) setActive({ ...a, next, page: e.ui.page });
      };
      valueSetters.current.set(id, f);
    }
    return f;
  };

  // ── The drive ends when the trip is gone (deleted, or I was removed), and on sign-out in ANY tab. ──
  useEffect(() => {
    const onGone = (ev: Event) => {
      const id = (ev as CustomEvent<{ tripId?: string }>).detail?.tripId;
      if (id && activeRef.current?.tripId === id) forget(id);
      if (id) setCache((c) => { if (!(id in c)) return c; const { [id]: _gone, ...rest } = c; void _gone; return rest; });
    };
    const signOut = () => {
      const a = activeRef.current;
      const e = a ? engines.get()[a.tripId] : undefined;
      // Stop sharing NOW, while still signed in (after sign-out the request would be refused), then wipe this person's drives.
      if (a && userId && e?.live.drive.share) { try { fire(createClient().from("live_locations").delete().eq("trip_id", a.tripId).eq("user_id", userId)); } catch { /* offline */ } }
      yielding.current = null;
      e?.live.drive.stop();
      const store = readStore();
      if (userId && store) clearUserDrives(store, userId);
      setActive(null); setRestore(null); setElsewhere(false); dropLock();
    };
    const onStorage = (ev: StorageEvent) => { if (ev.key === DRIVE_SIGN_OUT_KEY && userId && ev.newValue?.startsWith(`${userId}:`)) signOut(); };
    window.addEventListener(TRIP_GONE_EVENT, onGone);
    window.addEventListener(DRIVE_SIGN_OUT_EVENT, signOut);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(TRIP_GONE_EVENT, onGone); window.removeEventListener(DRIVE_SIGN_OUT_EVENT, signOut); window.removeEventListener("storage", onStorage); };
  }, [forget, engines, userId, dropLock, readStore]);

  const register = useCallback((r: Registration) => {
    setRegistered(r);
    setActive((a) => (a && a.tripId === r.tripId && r.page && a.page !== r.page ? { ...a, page: r.page } : a));
  }, []);
  const unregister = useCallback((tripId: string) => {
    const cur = registeredRef.current;
    if (!cur || cur.tripId !== tripId) return;
    setCache((c) => ({ ...c, [tripId]: cur.data })); // the drive keeps the last data it had while the traveller is elsewhere
    setRegistered((r) => (r && r.tripId === tripId ? null : r));
  }, []);

  const reconnecting = !!missing && failures > 0;
  const ctx = useMemo<Ctx>(() => ({ userId, engines, active, elsewhere, reconnecting, note, clearNote: () => setNote(null), register, unregister, endActive }), [userId, engines, active, elsewhere, reconnecting, note, register, unregister, endActive]);

  const pathname = usePathname() ?? "";
  const onActiveTrip = !!active && pathname.startsWith(`/trips/${active.tripId}`);
  const slots = checked ? [...new Set([activeId, pageId].filter((x): x is string => !!x))] : [];

  return (
    <DriveCtx.Provider value={ctx}>
      {children}
      {slots.map((id) => {
        const d = dataFor(id);
        if (!d) return null;
        const isActive = id === activeId;
        return (
          <DriveEngine
            key={id} data={d} restore={restore && restore.snapshot.tripId === id ? restore : null} refresh={refreshOf(id)} onValue={onValueOf(id)}
            onDriveStart={onDriveStart} onDriveEnd={onDriveEnd} canSave={isActive && owner} guardStart={isActive ? undefined : guardOf(id, d.trip.name)}
          />
        );
      })}
      <DriveBar />
      {/* On the trip's own pages its layout already watches for "deleted / removed"; elsewhere the drive needs its own watcher. */}
      {active && !onActiveTrip && !elsewhere && <TripGoneWatcher tripId={active.tripId} />}
    </DriveCtx.Provider>
  );
}

export function useDriveContext(): Ctx {
  return useContext(DriveCtx) ?? { userId: null, engines: nullStore, active: null, elsewhere: false, reconnecting: false, note: null, clearNote: () => {}, register: () => {}, unregister: () => {}, endActive: () => {} };
}

/** The engine for one trip (the drive, or the trip whose page is open), or null. */
export function useEngine(tripId: string | null | undefined): Engine | null {
  const ctx = useDriveContext();
  const all = useSyncExternalStore(ctx.engines.subscribe, ctx.engines.get, nullStore.get);
  return tripId ? all[tripId] ?? null : null;
}

export type TripEngineView = { status: "ready"; engine: Engine } | { status: "loading" };

/**
 * For the trip's Live and Map pages: hands the page's fresh data to the app-wide drive and returns the engine for THIS trip. The same
 * object on both pages (and after coming back from anywhere), so nothing restarts and nothing is lost.
 */
export function useTripEngine(data: TripData, refresh: () => void, page: "map" | "live"): TripEngineView {
  const ctx = useDriveContext();
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });
  const stableRefresh = useCallback(() => refreshRef.current(), []);
  const { register, unregister } = ctx;
  const tripId = data.trip.id;
  useEffect(() => { register({ tripId, data, refresh: stableRefresh, page }); }, [register, tripId, data, stableRefresh, page]);
  useEffect(() => () => unregister(tripId), [unregister, tripId]);
  const engine = useEngine(tripId);
  return engine ? { status: "ready", engine } : { status: "loading" };
}
