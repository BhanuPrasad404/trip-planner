"use client";

import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { AppAlert } from "@/lib/alerts/delivery";
import { useTollWatch, type TollView } from "@/lib/client/use-toll-watch";
import type { useTripLive } from "@/lib/client/use-trip-live";
import { formatAhead } from "@/lib/trip/toll";
import type { Vehicle } from "@/lib/vehicle";

type Live = ReturnType<typeof useTripLive>;

/** What a plaza line says. Distance only when we know it; a fee only if the map has one. Never a made-up amount. */
export const tollLine = (t: TollView["ahead"][number]) => [t.name ?? "Toll plaza", t.ref && t.ref !== t.name ? t.ref : null].filter(Boolean).join(" · ");
export const tollDetail = (t: TollView["ahead"][number]) => `${t.aheadM !== null ? `${formatAhead(Math.max(0, t.aheadM))} ahead` : "On this route"} · ${t.fee ? `Fee in map data: ${t.fee}` : "No fee listed in the map data"}`;

/** The honest footnote: where the data comes from and what it cannot promise. */
export function TollNote({ complete, unavailable }: { complete: boolean; unavailable: boolean }) {
  return (
    <p className="text-xs text-ink-muted">
      From OpenStreetMap. A plaza missing from the map won&apos;t be listed, and a fee is shown only when the map has one for your vehicle.
      {unavailable ? " We couldn't check this route for toll plazas, so there may be tolls ahead that aren't shown." : complete ? "" : " Part of this route couldn't be checked, so some plazas may be missing."}
    </p>
  );
}

/**
 * Toll plazas for the Live page. It is a card ONLY when there is a plaza ahead to show: nothing while loading, nothing when the check
 * found none or failed (those are reported quietly, in the route info on the map). The warning itself goes through the alert system.
 */
export function LiveTolls({ live, vehicle, notify, dismiss }: { live: Live; vehicle: Vehicle; notify: (a: AppAlert) => boolean; dismiss: (id: string) => void }) {
  const tolls = useTollWatch({ live, vehicle, notify, dismiss });
  const ahead = tolls.ahead.slice(0, 4);
  if (!tolls.navigating || ahead.length === 0) return null;
  return (
    <section aria-labelledby="tolls-heading" className="rounded-2xl border border-line bg-white p-3.5">
      <h2 id="tolls-heading" className="flex items-center gap-2 text-sm font-semibold text-pine"><Glyph name="car" size={16} className="text-marigold" />Tolls on this route</h2>
      <ul className="mt-1.5 divide-y divide-line">
        {ahead.map((t) => (
          <li key={t.id} className="py-2 text-sm"><p className="font-semibold text-pine">{tollLine(t)}</p><p className="text-ink-muted">{tollDetail(t)}</p></li>
        ))}
      </ul>
      <div className="mt-1.5"><TollNote complete={tolls.complete} unavailable={tolls.unavailable} /></div>
      {tolls.unavailable && <Button size="sm" variant="secondary" className="mt-1.5" onClick={tolls.retry}>Check again</Button>}
    </section>
  );
}
