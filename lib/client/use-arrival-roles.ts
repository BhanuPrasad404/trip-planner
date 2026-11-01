"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";
import type { RoleMap } from "@/lib/trip/arrival-roles";

const EMPTY = { roles: {} as RoleMap, sig: "" };
export const rolesKey = (tripId: string) => `tm:arrival-roles:${tripId}`;

/**
 * Which of the trip's stops are towns or cities (so arrival uses an area for them), asked of our server once per set of stops and kept
 * on this phone so it works with no signal. Until it is known, or if it cannot be asked, every stop is unknown and arrival works as it
 * always did (a point): a missing answer never widens a radius. Nothing about the traveller is sent: only the trip's id.
 */
export function useArrivalRoles(tripId: string, enabled: boolean, signature: string): RoleMap {
  const [saved, setSaved] = useLocalJson<{ roles: RoleMap; sig: string }>(rolesKey(tripId), EMPTY);
  const setRef = useRef(setSaved);
  useEffect(() => { setRef.current = setSaved; });
  const fresh = saved.sig === signature;
  useEffect(() => {
    if (!enabled || fresh) return;
    let cancelled = false;
    // A tick later: this is a request, not state to set while the page is still being put together.
    const t = window.setTimeout(() => {
      fetch(`/api/trips/${tripId}/arrival-roles`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { known?: boolean; roles?: RoleMap } | null) => { if (!cancelled && b?.known && b.roles && typeof b.roles === "object") setRef.current({ roles: b.roles, sig: signature }); })
        .catch(() => { /* offline or a server problem: what is saved stays, and unknown places stay points */ });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [tripId, enabled, fresh, signature]);
  // Saved answers are used even when they are for an older set of stops: a stop that was a city is still that city.
  return useMemo(() => (saved.roles && typeof saved.roles === "object" ? saved.roles : {}), [saved]);
}
