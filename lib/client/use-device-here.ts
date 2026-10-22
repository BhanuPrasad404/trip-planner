"use client";

// "Show weather where I am", when the traveller is not driving: the phone's position, asked for ONCE (on a tap), then remembered on this
// phone so later visits use it without asking again (only while the browser still allows it). Until then, the caller shows the planned
// start, labelled as such. Never shared with anyone, never saved anywhere but this phone's choice to use it.
import { useCallback, useEffect, useState } from "react";

const KEY = "tm:wx-here";
export type DeviceHere =
  | { status: "off" }
  | { status: "asking" }
  | { status: "on"; lat: number; lng: number; accuracyM: number | null; at: number }
  | { status: "denied" }
  | { status: "unavailable" };

const read = () => { try { return window.localStorage.getItem(KEY) === "on"; } catch { return false; } };
const write = (on: boolean) => { try { if (on) window.localStorage.setItem(KEY, "on"); else window.localStorage.removeItem(KEY); } catch { /* blocked: asked again next time */ } };

export function useDeviceHere(): { here: DeviceHere; request: () => void } {
  const [here, setHere] = useState<DeviceHere>({ status: "off" });

  const locate = useCallback((fromTap: boolean) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setHere({ status: "unavailable" }); return; }
    setHere({ status: "asking" });
    navigator.geolocation.getCurrentPosition(
      (pos) => { write(true); setHere({ status: "on", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null, at: Date.now() }); },
      (err) => { if (err.code === 1) { write(false); setHere({ status: "denied" }); } else setHere(fromTap ? { status: "unavailable" } : { status: "off" }); },
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 15_000 },
    );
  }, []);

  // Chosen before on this phone, and still allowed: use it again without asking.
  useEffect(() => {
    if (!read()) return;
    let cancelled = false;
    void Promise.resolve(navigator.permissions?.query({ name: "geolocation" as PermissionName })).then((st) => {
      if (cancelled) return;
      if (st?.state === "granted") locate(false); else if (st?.state === "denied") { write(false); setHere({ status: "denied" }); }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [locate]);

  return { here, request: useCallback(() => locate(true), [locate]) };
}
