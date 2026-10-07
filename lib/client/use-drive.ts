"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { distanceKm } from "@/lib/geo";
import { GRADE_LIMITS_M, assessFix, shouldPollForFix, type FixQuality } from "@/lib/location/quality";
import { shouldPublish, type Fix } from "@/lib/live";
import { createClient } from "@/lib/supabase/client";
import type { RouteLeg } from "@/lib/eta";
import { useLiveMembers, type LiveMember } from "./use-live-members";

export type DriveTarget = { id: string; name: string; lat: number; lng: number; plannedArrival: string | null };
/** `at` = when we received it; `fixAt` = when the device says it measured it (use this for freshness). */
export type Me = { lat: number; lng: number; heading: number | null; speedKmh: number | null; accuracyM: number | null; at: number; fixAt: number; /** A place the traveller chose (no GPS). Never shared with the group. */ manual?: boolean };
export type DriveRoute = { legs: RouteLeg[]; line: [number, number][]; source: "osrm" | "estimate"; stopIds: string[]; at: number };

export type Drive = {
  active: boolean;
  share: boolean;
  me: Me | null;
  /** The place the traveller chose as "where I am" instead of GPS, if any. */
  manualPlace: string | null;
  /** Use a chosen place as the start (for laptops without GPS). Real GPS takes over again as soon as it is precise. null = back to GPS. */
  setManual: (p: { lat: number; lng: number; label: string } | null) => void;
  /** How much to trust `me` (accuracy + age). Null until the first reading. */
  quality: FixQuality | null;
  /** Drive was pressed and we are still waiting for the first position. */
  locating: boolean;
  /** Increases every time Drive is started — lets callers remember a decision for THIS drive only. */
  session: number;
  error: string | null;
  route: DriveRoute | null;
  /** Minutes of continuous driving; resets after ~8 minutes standing still. Null when not driving. */
  drivingMin: number | null;
  members: Record<string, LiveMember>;
  start: () => void;
  stop: () => void;
  setShare: (share: boolean) => void;
};

const ETA_MOVE_KM = 1; // refresh the route after moving this far…
const ETA_MAX_AGE_MS = 90_000; // …or after this long, whichever comes first
const MAX_ETA_STOPS = 8;

/**
 * Drive mode: follows this device's GPS, optionally shares it with the trip's members,
 * and keeps the route + time left to the next stops up to date.
 * NOTE: browsers pause location when the screen is locked or the tab is in the background;
 * we ask the browser to keep the screen on while driving (Wake Lock) where supported.
 */
export function useDrive(tripId: string, userId: string, stops: DriveTarget[], allowLive: MutableRefObject<boolean>, fixRef?: MutableRefObject<((m: Me) => void) | null>, endRef?: MutableRefObject<(() => void) | null>): Drive {
  const [active, setActive] = useState(false);
  const [share, setShareState] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<DriveRoute | null>(null);
  const [drivingMin, setDrivingMin] = useState<number | null>(null);
  const [session, setSession] = useState(0);
  const [manualPlace, setManualPlace] = useState<string | null>(null);
  const manualRef = useRef(false);
  const meRef = useRef<Me | null>(null);
  const lastFixWall = useRef<number | null>(null);
  const [clock, setClock] = useState(0); // ticks while driving so "how old is this position?" stays true
  const members = useLiveMembers(tripId);
  const driveStart = useRef<number | null>(null);
  const lastMoved = useRef<{ at: number; lat: number; lng: number } | null>(null);

  const stopsRef = useRef(stops);
  const shareRef = useRef(share);
  const lastPublished = useRef<Fix | null>(null);
  const lastEta = useRef<{ lat: number; lng: number; at: number; key: string } | null>(null);
  const etaBusy = useRef(false);
  useEffect(() => {
    stopsRef.current = stops;
    shareRef.current = share;
  });

  const publish = useCallback(
    async (m: Me) => {
      const { error: upError } = await createClient()
        .from("live_locations")
        .upsert(
          { trip_id: tripId, user_id: userId, lat: m.lat, lng: m.lng, heading: m.heading, speed_kmh: m.speedKmh, accuracy_m: m.accuracyM, updated_at: new Date(m.at).toISOString() },
          { onConflict: "trip_id,user_id" }
        );
      if (upError) setError("Couldn't share your live location with the group. Check your connection (or that the latest database update was applied).");
    },
    [tripId, userId]
  );

  const refreshRoute = useCallback(async (m: Me) => {
    if (!allowLive.current) return; // not confirmed yet, or the position is too rough for exact ETAs
    const targets = stopsRef.current.slice(0, MAX_ETA_STOPS);
    if (targets.length === 0) {
      setRoute(null);
      lastEta.current = null;
      return;
    }
    const key = targets.map((t) => t.id).join(",");
    const last = lastEta.current;
    const changed = !last || last.key !== key;
    const moved = !last || distanceKm(last, m) >= ETA_MOVE_KM;
    const old = !last || m.at - last.at >= ETA_MAX_AGE_MS;
    if (etaBusy.current || !(changed || moved || old)) return;

    etaBusy.current = true;
    try {
      const res = await fetch("/api/eta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: [{ lat: m.lat, lng: m.lng }, ...targets.map((t) => ({ lat: t.lat, lng: t.lng }))] }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { legs: RouteLeg[]; line: [number, number][]; source: "osrm" | "estimate" };
      lastEta.current = { lat: m.lat, lng: m.lng, at: m.at, key };
      setRoute({ ...body, stopIds: targets.map((t) => t.id), at: m.at });
    } catch {
      /* keep showing the last route */
    } finally {
      etaBusy.current = false;
    }
  }, [allowLive]);

  // Follow the device while a drive is active.
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const onPos = (pos: GeolocationPosition) => {
        // A chosen start point stays until a PRECISE real reading arrives; vaguer readings must not replace it.
        if (manualRef.current) {
          if (!(pos.coords.accuracy > 0 && pos.coords.accuracy <= GRADE_LIMITS_M.fair)) return;
          manualRef.current = false;
          setManualPlace(null);
        }
        // Chrome's "Sensors" location override reports accuracy 0. Real devices never do; accept it ONLY in development.
        const simulated = process.env.NODE_ENV !== "production" && pos.coords.accuracy === 0;
        const m: Me = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading != null && !Number.isNaN(pos.coords.heading) && (pos.coords.speed ?? 0) > 1.5 ? pos.coords.heading : null,
          speedKmh: pos.coords.speed != null && !Number.isNaN(pos.coords.speed) ? Math.round(pos.coords.speed * 3.6) : null,
          accuracyM: simulated ? 10 : pos.coords.accuracy != null && Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          at: Date.now(),
          fixAt: pos.timestamp > 0 ? pos.timestamp : Date.now(),
        };
        setMe(m);
        setError(null);
        fixRef?.current?.(m); // navigation decides for itself how much to trust each fix

        // Continuous driving time: starts when we move, resets after a real stop (8+ minutes without moving).
        const moving = (m.speedKmh ?? 0) >= 8 || (lastMoved.current !== null && distanceKm(lastMoved.current, m) * 1000 >= 40);
        if (moving) {
          lastMoved.current = { at: m.at, lat: m.lat, lng: m.lng };
          driveStart.current ??= m.at;
        } else if (lastMoved.current === null) {
          lastMoved.current = { at: m.at, lat: m.lat, lng: m.lng };
        } else if (m.at - lastMoved.current.at >= 8 * 60_000) {
          driveStart.current = null;
        }
        setDrivingMin(driveStart.current !== null ? Math.round((m.at - driveStart.current) / 60_000) : 0);
        if (allowLive.current && shareRef.current && shouldPublish(lastPublished.current, m)) {
          lastPublished.current = m;
          void publish(m);
        }
        void refreshRoute(m);
        meRef.current = m;
        lastFixWall.current = Date.now();
      };
    const onErr = (err: GeolocationPositionError) => {
        // 1 = denied (stop). 2 = no position available. 3 = timed out — keep trying, a signal often arrives a little later.
        setError(
          err.code === 1
            ? "Location permission was denied. Allow it in your browser's site settings to use Drive mode."
            : err.code === 3
              ? "Still looking for your location… this can take a moment, especially indoors."
              : "Can't read your location right now. Check that GPS / location is turned on."
        );
        if (err.code === 1) {
          setActive(false);
          endRef?.current?.(); // permission denied or revoked: navigation ends with the drive instead of showing a frozen route
        }
      };
    // maximumAge 0: never answer with a cached position from earlier — the map must show where you are NOW.
    const id = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 25_000 });
    // Laptops (Wi-Fi/IP positioning) report only when their guess changes, so silence is normal for them. If nothing has
    // arrived for a while and we have no precise reading, ask once more in normal (non-GPS) mode instead of crying "signal lost".
    const refresh = window.setInterval(() => {
      if (!shouldPollForFix({ nowMs: Date.now(), lastFixAtMs: lastFixWall.current, accuracyM: meRef.current?.accuracyM ?? null, manual: manualRef.current })) return;
      navigator.geolocation.getCurrentPosition(onPos, () => {}, { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 });
    }, 5_000);

    // Keep the screen awake so location keeps flowing (released automatically when the tab is hidden, so re-request).
    let lock: WakeLockSentinel | null = null;
    const requestLock = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null; // unsupported or refused — Drive mode still works while the screen is on
      }
    };
    void requestLock();
    const onVisible = () => {
      if (document.visibilityState === "visible") void requestLock();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      navigator.geolocation.clearWatch(id);
      window.clearInterval(refresh);
      meRef.current = null;
      lastFixWall.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
      // Stopping the drive also stops sharing: remove our row so friends no longer see us.
      if (shareRef.current) void createClient().from("live_locations").delete().eq("trip_id", tripId).eq("user_id", userId);
      lastPublished.current = null;
      lastEta.current = null;
      driveStart.current = null;
      lastMoved.current = null;
    };
  }, [active, tripId, userId, publish, refreshRoute, allowLive, fixRef, endRef]);

  // While driving, tick every 5 s so a position that stops updating is shown as old instead of looking current.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setClock(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [active]);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser can't share location, so Drive mode isn't available here.");
      return;
    }
    setError(null);
    setMe(null); // never show an old position as if it were now
    setSession((n) => n + 1);
    setActive(true);
  }, []);

  const setManual = useCallback((p: { lat: number; lng: number; label: string } | null) => {
    if (!p) { manualRef.current = false; setManualPlace(null); setMe(null); return; } // back to GPS: wait for the next real reading
    const now = Date.now();
    manualRef.current = true;
    setManualPlace(p.label);
    setError(null);
    // accuracyM 50: a chosen TOWN is treated as a ~50 m start point. It is flagged manual: never shown as GPS, never shared.
    const m: Me = { lat: p.lat, lng: p.lng, heading: null, speedKmh: null, accuracyM: 50, at: now, fixAt: now, manual: true };
    setMe(m);
    fixRef?.current?.(m);
  }, [fixRef]);

  const stop = useCallback(() => {
    manualRef.current = false;
    setManualPlace(null);
    setActive(false);
    setMe(null);
    setRoute(null);
    setDrivingMin(null);
  }, []);

  const setShare = useCallback(
    (next: boolean) => {
      setShareState(next);
      shareRef.current = next;
      if (!next) void createClient().from("live_locations").delete().eq("trip_id", tripId).eq("user_id", userId);
      else lastPublished.current = null; // publish again on the next fix
    },
    [tripId, userId]
  );

  const quality = assessFix(me, clock || me?.at || 0);
  return { active, share, me, manualPlace, setManual, quality, locating: active && !me, session, error, route, drivingMin, members, start, stop, setShare };
}
