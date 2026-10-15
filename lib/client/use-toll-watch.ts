"use client";

import { useEffect, useRef } from "react";
import type { AppAlert } from "@/lib/alerts/delivery";
import { useTolls, type TollsState } from "@/lib/client/use-tolls";
import type { useTripLive } from "@/lib/client/use-trip-live";
import { emptyTollWatch, stepTollWatch, tollAlert, tollAlertId, tollsAhead, type TollOnRoute, type TollWatch } from "@/lib/trip/toll";
import type { Vehicle } from "@/lib/vehicle";

type Live = ReturnType<typeof useTripLive>;

/** A plaza this far ahead (m) is "relevant" enough to show on the map; further ones are listed in the route info only. */
export const RELEVANT_TOLL_M = 30_000;

export type TollView = {
  navigating: boolean;
  status: TollsState["status"];
  /** Part of the route could not be checked, so plazas may be missing. */
  complete: boolean;
  /** All automatic retries failed: tolls may exist ahead that we cannot see. */
  unavailable: boolean;
  ahead: (TollOnRoute & { aheadM: number | null })[];
  /** The nearest plaza still ahead and close enough to matter, or null. */
  next: (TollOnRoute & { aheadM: number }) | null;
  retry: () => void;
};

/**
 * Toll plazas on the road being driven, and the warning as one approaches. ONE implementation for every page that shows tolls.
 *   - warns once per plaza per route (about 5 km ahead along the route), through the alert system;
 *   - removes that warning when the plaza has been passed;
 *   - says nothing at all when there is nothing to say: a failed or empty check is handled quietly and reported only as a status.
 */
export function useTollWatch({ live, vehicle, notify, dismiss }: { live: Live; vehicle: Vehicle; notify: (a: AppAlert) => boolean; dismiss: (id: string) => void }): TollView {
  const nav = live.navigation;
  const route = nav.routes.find((r) => r.id === nav.selectedId) ?? null;
  const navigating = nav.phase === "navigating" && !!route;
  const tolls = useTolls(route?.line ?? null, vehicle, navigating);
  const watch = useRef<TollWatch>(emptyTollWatch());
  const forRoute = useRef<string | null>(null);

  // One warning per plaza per route; a new route (or a new vehicle's fees) starts afresh.
  useEffect(() => {
    const id = route ? `${route.id}|${vehicle}` : null;
    if (forRoute.current !== id) { forRoute.current = id; watch.current = emptyTollWatch(); }
    const p = nav.progress, me = live.drive.me;
    if (!navigating || !p || !me || tolls.status !== "ready") return;
    const routeTrusted = route?.source === "osrm" && !nav.rerouting && !nav.offRouteSuspected && !nav.uncertain && live.liveOk;
    const before = watch.current.passed;
    const r = stepTollWatch(watch.current, tolls.tolls, { alongM: p.alongM, speedKmh: me.speedKmh, accuracyM: me.accuracyM, fixAgeMs: Math.max(0, Date.now() - me.fixAt), offsetM: p.offsetM, routeTrusted });
    watch.current = r.state;
    for (const passedId of r.state.passed) if (!before.includes(passedId)) dismiss(tollAlertId(passedId)); // behind us now: the warning is over
    if (r.warn) notify(tollAlert(r.warn.toll, r.warn.aheadM));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs for each new position on the route, and when the plazas arrive
  }, [nav.progress, tolls.tolls]);

  const ahead = navigating ? tollsAhead(tolls.tolls, nav.progress?.alongM ?? null) : [];
  const nextRaw = ahead.find((t) => t.aheadM !== null && t.aheadM > 0 && t.aheadM <= RELEVANT_TOLL_M) ?? null;
  return {
    navigating, status: tolls.status, complete: tolls.complete, unavailable: navigating && tolls.status === "error" && tolls.exhausted,
    ahead, next: nextRaw ? ({ ...nextRaw, aheadM: nextRaw.aheadM as number }) : null, retry: tolls.retry,
  };
}
