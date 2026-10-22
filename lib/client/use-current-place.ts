"use client";

// The phone's position, turned into a start point with a readable name ("Madhapur, Hyderabad"). Rules (lib/location/start-location.ts):
//   • Location is read only after a tap — or straight away when this site is ALREADY allowed (no prompt ever appears by itself).
//   • The name is looked up on our server only when the phone has moved more than 1 km from the last named position; the last name is
//     kept on this phone (position rounded to ~100 m) so reopening the screen costs nothing.
//   • Offline, the position still works; the name comes from that saved one if it is close enough, otherwise it is named when back online.
//   • Nothing is sent to anyone else; nothing is saved on our side unless the traveller saves the trip.
import { useCallback, useEffect, useRef, useState } from "react";
import { useOnline } from "@/lib/client/use-connectivity";
import {
  GIVE_UP_AFTER_MS, SLOW_AFTER_MS, problemFromCode, reusableName, round3,
  type LocationProblem, type Permission, type StoredName,
} from "@/lib/location/start-location";

export const HERE_NAME_KEY = "tm:here-name:v1";

export type CurrentPlace =
  | { status: "idle"; permission: Permission }
  | { status: "locating"; slow: boolean }
  | { status: "problem"; problem: LocationProblem }
  | { status: "found"; lat: number; lng: number; accuracyM: number | null; name: string | null; area: string; naming: boolean; nameFailed: boolean };

export function readStoredName(): StoredName | null {
  try { const raw = window.localStorage.getItem(HERE_NAME_KEY); return raw ? (JSON.parse(raw) as StoredName) : null; } catch { return null; }
}
function storeName(v: StoredName) {
  try { window.localStorage.setItem(HERE_NAME_KEY, JSON.stringify(v)); } catch { /* storage blocked: we simply ask again next time */ }
}

async function permissionState(): Promise<Permission> {
  try {
    const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return st?.state === "granted" || st?.state === "denied" || st?.state === "prompt" ? st.state : "unknown";
  } catch { return "unknown"; }
}

/**
 * `auto` = fill without a tap when the site is already allowed. `enabled: false` = this field doesn't offer location at all (nothing is
 * asked, not even the permission state). `now` is injectable for tests.
 */
export function useCurrentPlace(opts: { auto?: boolean; enabled?: boolean; now?: () => number } = {}) {
  const { auto = false, enabled = true } = opts;
  const now = opts.now ?? Date.now;
  const [state, setState] = useState<CurrentPlace>({ status: "idle", permission: "unknown" });
  const online = useOnline();
  const run = useRef(0);
  const nowRef = useRef(now);
  useEffect(() => { nowRef.current = now; });

  const name = useCallback(async (lat: number, lng: number, attempt: number) => {
    const here = { lat: round3(lat), lng: round3(lng) };
    const saved = reusableName(readStoredName(), here, nowRef.current());
    if (saved) {
      setState((s) => (run.current === attempt && s.status === "found" ? { ...s, name: saved.name, area: saved.area, naming: false, nameFailed: false } : s));
      return;
    }
    try {
      const res = await fetch("/api/place-here", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(here) });
      const body = (await res.json().catch(() => null)) as { found?: boolean; name?: string; area?: string } | null;
      if (run.current !== attempt) return;
      if (res.ok && body?.found && body.name) {
        storeName({ ...here, name: body.name, area: body.area ?? "", at: nowRef.current() });
        setState((s) => (s.status === "found" ? { ...s, name: body.name!, area: body.area ?? "", naming: false, nameFailed: false } : s));
      } else {
        setState((s) => (s.status === "found" ? { ...s, naming: false, nameFailed: true } : s));
      }
    } catch {
      if (run.current === attempt) setState((s) => (s.status === "found" ? { ...s, naming: false, nameFailed: true } : s));
    }
  }, []);

  const locate = useCallback(() => {
    if (typeof window !== "undefined" && window.isSecureContext === false) { setState({ status: "problem", problem: "insecure" }); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setState({ status: "problem", problem: "unsupported" }); return; }
    const attempt = ++run.current;
    setState({ status: "locating", slow: false });
    const slow = setTimeout(() => { if (run.current === attempt) setState((s) => (s.status === "locating" ? { status: "locating", slow: true } : s)); }, SLOW_AFTER_MS);
    // Our own deadline as well as the browser's: some phones never call back at all when location is off.
    const giveUp = setTimeout(() => { if (run.current === attempt) { run.current++; setState({ status: "problem", problem: "timeout" }); } }, GIVE_UP_AFTER_MS + 1_000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(slow); clearTimeout(giveUp);
        if (run.current !== attempt) return;
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setState({ status: "found", lat, lng, accuracyM: Number.isFinite(accuracy) ? accuracy : null, name: null, area: "", naming: true, nameFailed: false });
        void name(lat, lng, attempt);
      },
      (err) => {
        clearTimeout(slow); clearTimeout(giveUp);
        if (run.current !== attempt) return;
        setState({ status: "problem", problem: problemFromCode(err?.code ?? 2) });
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: GIVE_UP_AFTER_MS },
    );
  }, [name]);

  // Already allowed on this phone → fill it in without asking. Not allowed yet → show the button. Blocked → say how to allow it.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let status: PermissionStatus | null = null;
    const onChange = () => {
      const p = status?.state;
      if (p === "denied") setState({ status: "problem", problem: "denied" });
      else if (p === "granted" || p === "prompt") setState((s) => (s.status === "problem" && s.problem === "denied" ? { status: "idle", permission: p } : s));
    };
    void (async () => {
      const p = await permissionState();
      if (cancelled) return;
      if (p === "denied") setState({ status: "problem", problem: "denied" });
      else if (p === "granted" && auto) locate();
      else setState((s) => (s.status === "idle" ? { status: "idle", permission: p } : s));
      try {
        status = (await navigator.permissions?.query({ name: "geolocation" as PermissionName })) ?? null;
        if (!cancelled && status) status.addEventListener?.("change", onChange);
      } catch { /* this browser can't watch the permission: the button still works */ }
    })();
    return () => { cancelled = true; status?.removeEventListener?.("change", onChange); };
  }, [auto, enabled, locate]);

  // Coming back ONLINE with a position we could not name: name it now. Only on that change (never in a loop while a server keeps failing).
  const wasOnline = useRef(online);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    const s = stateRef.current;
    if (!cameBack || s.status !== "found" || s.name !== null || !s.nameFailed) return;
    setState((x) => (x.status === "found" ? { ...x, naming: true, nameFailed: false } : x));
    void name(s.lat, s.lng, run.current);
  }, [online, name]);

  const reset = useCallback(() => { run.current++; setState({ status: "idle", permission: "unknown" }); }, []);
  return { place: state, locate, reset, online };
}
