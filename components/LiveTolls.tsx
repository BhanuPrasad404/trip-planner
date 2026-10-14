"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { AppAlert } from "@/lib/alerts/delivery";
import { useTolls } from "@/lib/client/use-tolls";
import type { useTripLive } from "@/lib/client/use-trip-live";
import { emptyTollWatch, formatAhead, stepTollWatch, tollAlert, tollsAhead, type TollWatch } from "@/lib/trip/toll";
import type { Vehicle } from "@/lib/vehicle";

type Live = ReturnType<typeof useTripLive>;

/**
 * Toll plazas on the road you are actually driving: a short list while navigating, and a warning (through the alert system) as one
 * approaches. Everything comes from map data, so the card says what it cannot know: a plaza the map is missing will not be listed, and a
 * fee is shown only if the map has one. If the check fails, navigation is not affected.
 */
export function LiveTolls({ live, vehicle, notify }: { live: Live; vehicle: Vehicle; notify: (a: AppAlert) => boolean }) {
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
    const r = stepTollWatch(watch.current, tolls.tolls, { alongM: p.alongM, speedKmh: me.speedKmh, accuracyM: me.accuracyM, fixAgeMs: Math.max(0, Date.now() - me.fixAt), offsetM: p.offsetM, routeTrusted });
    watch.current = r.state;
    if (r.warn) notify(tollAlert(r.warn.toll, r.warn.aheadM));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs for each new position on the route, and when the plazas arrive
  }, [nav.progress, tolls.tolls]);

  if (!navigating) return null;
  const ahead = tollsAhead(tolls.tolls, nav.progress?.alongM ?? null).slice(0, 4);
  return (
    <section aria-labelledby="tolls-heading" className="rounded-2xl border border-line bg-white p-3.5">
      <h2 id="tolls-heading" className="flex items-center gap-2 text-sm font-semibold text-pine"><Glyph name="car" size={16} className="text-marigold" />Tolls on this route</h2>
      {tolls.status === "loading" && <p role="status" className="mt-1.5 text-sm text-ink-muted">Checking this route for toll plazas…</p>}
      {tolls.status === "error" && (
        <div role="status" className="mt-1.5">
          <p className="text-sm text-ink-muted">{tolls.error} Navigation isn&apos;t affected.</p>
          <Button size="sm" variant="secondary" className="mt-1.5" onClick={tolls.retry}>Try again</Button>
        </div>
      )}
      {tolls.status === "ready" && (
        <>
          {ahead.length === 0 ? (
            <p className="mt-1.5 text-sm text-ink-muted">No toll plazas found ahead on this route in map data.</p>
          ) : (
            <ul className="mt-1.5 divide-y divide-line">
              {ahead.map((t) => (
                <li key={t.id} className="py-2 text-sm">
                  <p className="font-semibold text-pine">{[t.name ?? "Toll plaza", t.ref && t.ref !== t.name ? t.ref : null].filter(Boolean).join(" · ")}</p>
                  <p className="text-ink-muted">{t.aheadM !== null ? `${formatAhead(Math.max(0, t.aheadM))} ahead` : "On this route"} · {t.fee ? `Fee in map data: ${t.fee}` : "No fee listed in the map data"}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-ink-muted">From OpenStreetMap. A plaza missing from the map won&apos;t be listed, and a fee is shown only when the map has one for your vehicle.{tolls.complete ? "" : " Part of this route couldn't be checked, so some plazas may be missing."}</p>
        </>
      )}
    </section>
  );
}
