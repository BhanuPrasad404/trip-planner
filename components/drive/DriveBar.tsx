"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Glyph } from "@/components/ui/Glyph";
import { kmText } from "@/lib/trip/remaining";
import { useDriveContext, useEngine } from "./DriveProvider";

/**
 * "Driving to Golconda Fort · 12 km" on every page except the drive's own map and live screens, so the traveller can look at
 * something else and get back to the drive in one tap. Also where a paused drive (after a reload) is resumed, and where the app says
 * the drive is running in another tab or ended by itself.
 */
export function DriveBar() {
  const ctx = useDriveContext();
  const a = ctx.active;
  const engine = useEngine(a?.tripId);
  const pathname = usePathname() ?? "";
  const onDrivePage = !!a && (pathname === `/trips/${a.tripId}/map` || pathname === `/trips/${a.tripId}/live`);
  const e = engine && a && engine.tripId === a.tripId ? engine : null;
  const driving = !!e && e.live.drive.active;
  const paused = !!e && e.paused;

  let body: React.ReactNode = null;
  if (ctx.elsewhere) {
    body = (
      <p className="min-w-0 flex-1 text-sm font-semibold"><Glyph name="navigate" size={16} className="mr-1.5 inline align-text-bottom text-marigold" />Your drive{a ? ` (${a.tripName})` : ""} is running in another Trailmate tab.</p>
    );
  } else if (a && !onDrivePage && (driving || paused || !e)) {
    const left = e?.live.distanceLeft && e.live.nextTarget && e.live.distanceLeft.next.id === e.live.nextTarget.id ? e.live.distanceLeft : null;
    const name = e?.live.nextTarget?.name ?? a.next?.name ?? null;
    // Off the drive's own screens an alert (a toll plaza ahead) would otherwise only be heard: it is shown here too.
    const alert = e?.alerts.active[0] ?? null;
    body = (
      <>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{paused ? `Drive paused · ${a.tripName}` : name ? `Driving to ${name}` : `Driving · ${a.tripName}`}</p>
          {alert && !paused
            ? <p role="status" className="truncate text-xs font-semibold text-marigold"><Glyph name="warn" size={12} className="mr-1 inline align-[-1px]" />{alert.title}</p>
            : <p className="truncate text-xs text-white/75">{paused ? "Your drive was saved. Tap Resume to follow GPS again." : ctx.reconnecting ? "Reconnecting… (no signal to load the trip yet)" : left ? `${kmText(left.next.km, left)} · about ${left.next.minutes} min` : a.tripName}</p>}
        </div>
        {paused && e ? (
          <button type="button" onClick={e.live.drive.start} className="min-h-11 shrink-0 rounded-full bg-marigold px-4 text-sm font-bold text-pine">Resume</button>
        ) : null}
        <Link href={`/trips/${a.tripId}/${a.page}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-white/15 px-4 text-sm font-bold">Return<span className="sr-only"> to your drive</span><Glyph name="arrow" size={16} /></Link>
      </>
    );
  } else if (ctx.note) {
    body = (
      <>
        <p role="status" className="min-w-0 flex-1 text-sm">{ctx.note}</p>
        <button type="button" onClick={ctx.clearNote} aria-label="Dismiss" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15"><Glyph name="close" size={16} /></button>
      </>
    );
  }
  if (!body) return null;
  return (
    <>
      {/* Room for the bar at the end of the page, so it never covers the last thing on it. */}
      <div aria-hidden="true" className="h-20 md:h-0" />
      <div
        role="region" aria-label="Your drive" data-testid="drive-bar"
        className="fixed inset-x-2 bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+4.75rem)] z-40 mx-auto flex max-w-xl items-center gap-2 rounded-2xl bg-pine/95 px-3 py-2 text-white shadow-xl backdrop-blur md:inset-x-auto md:bottom-4 md:right-4 md:w-[26rem]"
      >
        {body}
      </div>
    </>
  );
}
