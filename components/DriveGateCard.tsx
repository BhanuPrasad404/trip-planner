"use client";

import { Button, buttonClasses } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { Drive } from "@/lib/client/use-drive";
import { googleMapsDirections } from "@/lib/maps-links";
import type { StartCheck } from "@/lib/location/start-check";
import { dayWithDate } from "@/lib/time-context";
import { PlaceSearch } from "./PlaceSearch";

/** For laptops and anywhere GPS is missing: say where you are, in words. Used only for YOUR directions; never shared. */
function ChooseWhereIAm({ drive, near, open, plannedStart, onChosen }: { drive: Drive; near: { lat: number; lng: number } | null; open?: boolean; plannedStart?: { lat: number; lng: number; label: string } | null; onChosen?: () => void }) {
  return (
    <details open={open} className="mt-3 rounded-xl border border-line bg-white/80 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-pine">No GPS on this device? Choose where you are</summary>
      <p className="mt-2 text-xs text-ink-muted">Laptops usually have no GPS, so the browser only guesses from your internet connection. Pick your town and we&apos;ll plan the road route from there. The dot will not move until real GPS is available, and nothing is shared with the group.</p>
      {plannedStart && (
        <Button size="sm" className="mt-2 w-full sm:w-auto" onClick={() => { drive.setManual({ lat: plannedStart.lat, lng: plannedStart.lng, label: plannedStart.label }); onChosen?.(); }}>
          <span className="inline-flex items-center gap-1.5"><Glyph name="play" size={16} />Show the route from {plannedStart.label}</span>
        </Button>
      )}
      <div className="mt-2">
        <PlaceSearch label="Where are you right now?" placeholder="e.g. Mothkur" near={near} value={null} onChange={(p) => { if (p) drive.setManual({ lat: p.lat, lng: p.lng, label: p.name }); }} />
      </div>
    </details>
  );
}

type Gate = { tripId?: string; hereLabel?: string | null; open: boolean; confirmed: boolean; check: StartCheck | null; confirm: () => void; plannedStart: { lat: number; lng: number; label: string } | null; today: string | null; driveDay: number };

/**
 * Shown right after "Start drive", BEFORE anything goes live:
 *  • waiting for the first position (never a cached one)
 *  • trip planned for another day → start early?
 *  • you are not where the plan starts → start from here / go to the start first?
 *  • the position is only approximate → say so
 * The plan itself is never rewritten by this card.
 */
export function DriveGateCard({ drive, gate }: { drive: Drive; gate: Gate }) {
  if (!drive.active) return null;

  if (!drive.me) {
    return (
      <div role="status" className="rounded-2xl border border-line bg-white p-4 text-sm">
        <p className="font-semibold text-pine">Finding your location…</p>
        <p className="mt-1 text-ink-muted">{drive.error ?? "Your browser will ask to use your location. Choose Allow — and Precise, if your phone asks. We always wait for a fresh reading, never an old one."}</p>
        <ChooseWhereIAm drive={drive} near={gate.plannedStart} plannedStart={gate.plannedStart} onChosen={gate.confirm} />
      </div>
    );
  }
  const early = gate.check?.issues.find((i) => i.kind === "early");
  // After confirming an early start, keep one quiet line so nobody forgets the plan is for another day.
  if (!gate.open && gate.confirmed && early && gate.today) {
    return (
      <p role="note" className="flex items-start gap-2 rounded-xl bg-sky px-3 py-2 text-sm text-ink-muted">
        <Glyph name="info" size={16} className="mt-0.5 shrink-0 text-pine" />
        <span><strong className="text-pine">Early start.</strong> You&apos;re driving on {dayWithDate(gate.today, gate.today)}; your plan is for {dayWithDate(early.plannedDate, gate.today)}. Stop times are still your planned times.</span>
      </p>
    );
  }
  if (!gate.open || !gate.check) return null;

  const issues = gate.check.issues;
  const noDates = issues.find((i) => i.kind === "no-dates");
  const onlyNoDates = !!noDates && issues.length === 1;
  const late = issues.find((i) => i.kind === "late");
  const away = issues.find((i) => i.kind === "away-from-start");
  const unsure = issues.find((i) => i.kind === "unsure-position");
  const today = gate.today;

  return (
    <section role="alertdialog" aria-labelledby="gate-heading" className="rounded-2xl border-2 border-marigold bg-marigold-light/60 p-4 sm:p-5">
      <h2 id="gate-heading" className="font-display text-lg font-semibold text-pine">Before you set off</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {noDates && (
          <li className="flex items-start gap-2"><Glyph name="calendar" size={16} className="mt-0.5 shrink-0 text-pine" />
            <span>
              Your trip dates aren&apos;t set yet. Set them to check destination opening hours, weather forecasts, estimated arrival times and travel conditions.
              You can still drive now with limited checks: your route and live position work as usual.
            </span>
          </li>
        )}
        {early && today && (
          <li className="flex items-start gap-2"><Glyph name="info" size={16} className="mt-0.5 shrink-0 text-pine" />
            <span>
              This trip is planned for <strong>{dayWithDate(early.plannedDate, today)}</strong>, but today is <strong>{dayWithDate(today, today)}</strong>.
              You&apos;re starting early. Your plan stays exactly as it is; we&apos;ll use today&apos;s real time and your real position, and the times shown for stops are still your <em>planned</em> times.
            </span>
          </li>
        )}
        {late && today && (
          <li className="flex items-start gap-2"><Glyph name="info" size={16} className="mt-0.5 shrink-0 text-pine" />
            <span>The planned dates for this trip ended on <strong>{dayWithDate(late.plannedDate, today)}</strong>. You can still drive it — we&apos;ll use today&apos;s real time.</span>
          </li>
        )}
        {away && (
          <li className="flex items-start gap-2"><Glyph name="pin" size={16} className="mt-0.5 shrink-0 text-pine" />
            <span>
              You&apos;re {gate.hereLabel ? <>currently near <strong>{gate.hereLabel}</strong>, </> : "currently "}about <strong>{Math.round(away.km)} km</strong> from your planned starting point (<strong>{away.startLabel}</strong>).
              Your plan still starts in {away.startLabel}; this drive will start from where you are.
            </span>
          </li>
        )}
        {unsure && (
          <li className="flex items-start gap-2"><Glyph name="warn" size={16} className="mt-0.5 shrink-0 text-clay-ink" />
            <span>{unsure.message} {away ? "" : "We can't tell yet whether you're at your starting point."}</span>
          </li>
        )}
      </ul>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {unsure && !away && gate.plannedStart ? (
          // The position is only approximate (typical on a laptop), so there is no honest "from where I am". Say so and offer
          // the route from the PLANNED start instead of leaving the map empty. Real GPS takes over by itself once it is precise.
          <Button onClick={() => { drive.setManual({ lat: gate.plannedStart!.lat, lng: gate.plannedStart!.lng, label: gate.plannedStart!.label }); gate.confirm(); }}>
            <span className="inline-flex items-center gap-1.5"><Glyph name="play" size={16} />Show the route from {gate.plannedStart.label}</span>
          </Button>
        ) : (
          <Button onClick={gate.confirm}>
            {onlyNoDates ? "Continue with limited checks" : unsure && !away && !early ? "Continue with an approximate position" : away ? "Start from where I am" : "Start now"}
          </Button>
        )}
        {noDates && gate.tripId && <a href={`/trips/${gate.tripId}/plan#dates-heading`} className={buttonClasses("secondary", "md")}><Glyph name="calendar" size={16} />Set trip dates</a>}
        {unsure && !away && gate.plannedStart && <Button variant="secondary" onClick={gate.confirm}>Wait for a precise position</Button>}
        {away && gate.plannedStart && (
          <Button
            variant="secondary"
            onClick={() => {
              window.open(googleMapsDirections(gate.plannedStart!), "_blank", "noopener,noreferrer");
              drive.stop();
            }}
          >
            Go to {away.startLabel} first
          </Button>
        )}
        <Button variant="secondary" onClick={drive.stop}>{away ? "Keep my plan, not now" : "Not now"}</Button>
      </div>
      {unsure && <ChooseWhereIAm drive={drive} near={gate.plannedStart} open />}
      {drive.me && drive.quality && !drive.quality.usable && <p className="mt-3 text-xs text-ink-muted">Until your position is precise, distances, arrival times and sharing with the group stay off.</p>}
    </section>
  );
}
