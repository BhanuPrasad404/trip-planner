"use client";

import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { Spinner } from "@/components/ui/Spinner";
import type { GlyphName } from "@/lib/glyphs";
import type { Navigation } from "@/lib/client/use-navigation";
import { formatDuration } from "@/lib/format";
import type { Journey } from "@/lib/map/journey";
import type { Banner } from "@/lib/map/navigation";
import { SESSION_TEXT, type SessionState } from "@/lib/map/session-state";
import { navNotices } from "@/lib/map/notices";
import { useHudNotices } from "@/lib/client/use-hud-notices";
import { HudNotices } from "./HudNotices";

const ARROW: Record<Banner["arrow"], { glyph: GlyphName; rotate: number }> = {
  left: { glyph: "turnLeft", rotate: 0 }, right: { glyph: "turnRight", rotate: 0 },
  "sharp-left": { glyph: "turnLeft", rotate: -20 }, "sharp-right": { glyph: "turnRight", rotate: 20 },
  "slight-left": { glyph: "arrowUp", rotate: -35 }, "slight-right": { glyph: "arrowUp", rotate: 35 },
  straight: { glyph: "arrowUp", rotate: 0 }, depart: { glyph: "arrowUp", rotate: 0 },
  uturn: { glyph: "uturn", rotate: 0 }, roundabout: { glyph: "roundabout", rotate: 0 }, arrive: { glyph: "flag", rotate: 0 },
};

/** "02:10 pm", or "01:20 am (tomorrow)" when the arrival is past midnight — nobody should have to work out which day. */
const clock = (ms: number, nowMs?: number) => {
  const t = new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (!nowMs) return t;
  const day = (x: number) => { const d = new Date(x); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const diff = Math.round((day(ms) - day(nowMs)) / 86_400_000);
  return diff <= 0 ? t : diff === 1 ? `${t} (tomorrow)` : `${t} (+${diff} days)`;
};
const ABBR = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const abbr = (b: number) => ABBR[Math.round((((b % 360) + 360) % 360) / 45) % 8];
const km = (m: number) => (m >= 1000 ? `${(Math.round(m / 100) / 10).toLocaleString("en-IN")} km` : `${Math.round(m / 10) * 10} m`);
const kmN = (k: number) => `${k >= 100 ? Math.round(k).toLocaleString("en-IN") : k.toLocaleString("en-IN")} km`;

export type NavUi = {
  nav: Navigation;
  session: SessionState;
  follow: boolean;
  headingUp: boolean;
  journey: Journey | null;
  startedFrom: { label: string | null; plannedLabel: string; km: number } | null;
  /** The place the traveller chose instead of GPS, if any. */
  manualPlace: string | null;
  speedKmh: number | null;
  /** Position quality, so a weak or lost GPS signal is stated instead of hidden. */
  signal: { grade: string; message: string } | null;
  onRecenter: () => void;
  onOverview: () => void;
  onToggleHeading: () => void;
  onArrivedDone?: () => void;
  /** Wall-clock now (ms), from the latest GPS reading; lets arrival times say "tomorrow" after midnight. */
  nowMs: number;
  /** Driving, but today's route has nothing left (every stop done, skipped or removed): say so plainly instead of an empty panel. */
  noMoreStops?: { planHref: string } | null;
};

/**
 * The turn banner and ONE status message. Everything navigation wants to say (session status, a weak position, "guidance paused", a note)
 * goes through the same prioritiser as the rest of the map (lib/map/notices.ts): the most important message is shown, the others wait.
 * `inFlow`: part of the map's top stack (nothing can overlap it); otherwise it floats over the map's top edge (the Live page's small map).
 */
export function NavigationBanner({ ui, inFlow = false }: { ui: NavUi; inFlow?: boolean }) {
  const { nav, session, signal } = ui;
  const chip = SESSION_TEXT[session];
  const showSignal = !!signal && ["stale", "rough", "poor"].includes(signal.grade) && session !== "not-started" && session !== "confirming";
  const list = navNotices({
    session: chip && session !== "arrived" && session !== "confirming" ? { id: `session:${session}`, text: session === "error" && nav.error ? nav.error : chip, tone: session === "error" ? "error" : session === "off-route" || session === "recalculating" ? "warn" : "info" } : null,
    signal: showSignal ? signal!.message : null,
    uncertain: nav.uncertain && nav.phase === "navigating",
    notice: nav.notice ?? null,
  });
  const notices = useHudNotices(list, 1);
  const dismiss = (id: string) => { notices.dismiss(id); if (id === "nav-notice") nav.dismissNotice(); };
  return (
    <div className={inFlow ? "pointer-events-none space-y-2 [&>*]:pointer-events-auto" : "pointer-events-none absolute inset-x-2 top-2 z-30 mx-auto max-w-xl space-y-2 md:left-auto md:right-14 md:top-3 md:mx-0"} style={inFlow ? undefined : { paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {nav.phase === "navigating" && nav.banner && (() => {
        const arrow = ARROW[nav.banner.arrow];
        return (
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-pine px-3 py-2 text-white shadow-xl sm:gap-4 sm:px-4 sm:py-3" role="region" aria-label="Next maneuver">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 sm:h-14 sm:w-14" style={{ transform: `rotate(${arrow.rotate}deg)` }}><Glyph name={arrow.glyph} size={30} strokeWidth={2.4} /></span>
            <div className="min-w-0">
              <p className="font-display text-2xl font-semibold leading-none sm:text-3xl">{nav.banner.distanceText}</p>
              <p className="mt-0.5 line-clamp-2 break-words text-sm font-medium leading-snug sm:mt-1 sm:text-base">{nav.banner.instruction}</p>
            </div>
          </div>
        );
      })()}
      <div className="pointer-events-auto empty:hidden"><HudNotices shown={notices.shown} hiddenCount={0} onDismiss={dismiss} /></div>
    </div>
  );
}

/** Destination, distance, ETA and the controls. `floating`: a sheet over the map; otherwise a normal card in the page. */
export function NavigationPanel({ ui, floating = true }: { ui: NavUi; floating?: boolean }) {
  const { nav, journey, startedFrom, follow, headingUp, session } = ui;
  const target = nav.target;
  // On the map (a bottom sheet) the details start folded so the map stays the main thing; in the page they start open.
  const [more, setMore] = useState(!floating);
  if (nav.phase === "loading" && target) {
    // Immediate feedback: say what is happening, to where, and that it can be cancelled — never a blank map.
    return (
      <Shell floating={floating}>
        <div role="status" aria-live="polite" className="flex items-center gap-3">
          <Spinner size={32} className="text-teal" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-semibold text-pine">Finding the road route…</p>
            <p className="truncate text-xs text-ink-muted">to {target.name}</p>
          </div>
          <Button size="sm" variant="secondary" className="min-h-11" onClick={nav.stop}>Cancel</Button>
        </div>
      </Shell>
    );
  }
  if (!target && ui.noMoreStops) {
    return (
      <Shell floating={floating}>
        <p role="status" className="font-display text-lg font-semibold text-pine">No more stops today</p>
        <p className="mt-0.5 text-sm text-ink-muted">Nothing is left on today&apos;s route. Add a stop in the plan, or end the drive.</p>
        <div className="mt-3"><LinkButton href={ui.noMoreStops.planHref} size="sm" variant="secondary" className="min-h-11">Open the plan</LinkButton></div>
      </Shell>
    );
  }
  if (!target || nav.phase === "idle" || nav.phase === "loading" || nav.phase === "error") {
    if (nav.phase === "error") {
      return (
        <Shell floating={floating}>
          <p role="alert" className="text-sm font-semibold text-clay-ink">{nav.error ?? "Couldn't get directions right now."}</p>
          <p className="mt-0.5 text-xs text-ink-muted">Your trip is unchanged. We try again by ourselves every 15 seconds, or you can try now.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" className="min-h-11" onClick={nav.retry}>Try again</Button><Button size="sm" variant="secondary" className="min-h-11" onClick={nav.stop}>Stop navigation</Button></div>
        </Shell>
      );
    }
    return null;
  }

  if (nav.phase === "choosing") {
    return (
      <Shell floating={floating}>
        <h2 className="font-display text-lg font-semibold text-pine">Routes to {target.name}</h2>
        <ul className="mt-2 space-y-2" aria-label="Route choices">
          {nav.choices.map((c) => {
            const on = c.id === nav.selectedId;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => nav.choose(c.id)} aria-pressed={on} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 text-left ${on ? "border-[#1a73e8] bg-[#e8f0fe]" : "border-line bg-white hover:border-[#1a73e8]"}`}>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-pine">{c.title}{c.via ? ` · ${c.via}` : ""}</span>
                    <span className="block text-xs text-ink-muted">
                      {c.km} km{c.deltaMin > 0 || c.deltaKm !== 0 ? ` · ${c.deltaMin > 0 ? `${c.deltaMin} min slower` : "same time"}${c.deltaKm < 0 ? `, ${Math.abs(c.deltaKm)} km shorter` : c.deltaKm > 0 ? `, ${c.deltaKm} km longer` : ""}` : ""}
                      {c.badges.length > 0 && <span className="ml-1 font-semibold text-[#1a73e8]">{c.badges.join(" · ")}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-lg font-semibold text-pine">{formatDuration(c.minutes)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-ink-muted">Times use typical road speeds. Live traffic isn&apos;t connected.</p>
        <div className="mt-3 flex gap-2">
          <Button onClick={nav.begin} className="flex-1"><span className="inline-flex items-center gap-2"><Glyph name="play" size={16} />Go this way</span></Button>
          <Button variant="secondary" onClick={nav.armed ? nav.retry : nav.stop}>Back</Button>
        </div>
      </Shell>
    );
  }

  if (nav.phase === "arrived") {
    return (
      <Shell floating={floating}>
        <p role="status" className="font-display text-lg font-semibold text-pine"><Glyph name="flag" size={18} className="mr-2 inline align-text-bottom text-[#d93025]" />You have arrived at {target.name}</p>
        <div className="mt-3 flex gap-2">
          {ui.onArrivedDone && <Button onClick={() => { ui.onArrivedDone?.(); }}>Mark done and continue</Button>}
          <Button variant={ui.onArrivedDone ? "secondary" : "primary"} onClick={nav.stop}>{target.kind === "destination" ? "Finish" : "End navigation"}</Button>
        </div>
      </Shell>
    );
  }

  const p = nav.progress;
  const expanded = more || nav.alternatives.length > 0 || nav.altLoading;
  const etaText = journey ? formatDuration(Math.max(1, journey.remainingMin)) : p ? formatDuration(Math.max(1, Math.round(p.remainingS / 60))) : "—";
  const subText = journey ? `${journey.kmLabel ?? kmN(journey.remainingKm)} · arrive about ${clock(journey.etaMs, ui.nowMs)}` : p ? `${km(p.remainingM)} · arrive about ${clock(p.etaMs, ui.nowMs)}` : "Working out your position…";
  return (
    <Shell floating={floating}>
      {/* Always visible: where, how long, how far — and the two controls you may need in a hurry. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-muted">{journey || target.kind === "destination" ? "Destination" : "Heading to"}</p>
          <p className="truncate font-display text-lg font-semibold leading-tight text-pine sm:text-xl">{journey ? journey.name : target.name}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-2xl font-semibold leading-none text-teal-ink">{etaText}</p>
          <p className="mt-1 text-xs text-ink-muted">{subText}</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {(!follow || session === "exploring") && <Button size="sm" className="min-h-11 flex-1" onClick={ui.onRecenter}><span className="inline-flex items-center gap-1.5"><Glyph name="locate" size={16} />Re-centre</span></Button>}
        <Button size="sm" variant="secondary" className="min-h-11 flex-1" onClick={nav.stop}>End</Button>
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={expanded} aria-label={expanded ? "Hide route details" : "Show route details and options"} className="grid h-11 min-w-11 place-items-center rounded-xl border border-line px-3 text-pine"><Glyph name={expanded ? "down" : "up"} size={18} /></button>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-line pt-3">
          {journey && p && <p className="text-xs text-ink-muted">Next stop: <strong className="text-pine">{target.name}</strong> · {km(p.remainingM)} · {formatDuration(Math.max(1, Math.round(p.remainingS / 60)))}</p>}
          {startedFrom && <p className="mt-1 text-xs text-ink-muted">Driving from <strong className="text-pine">{startedFrom.label ?? "where you are"}</strong>. Your planned start ({startedFrom.plannedLabel}) is unchanged.</p>}
          {ui.manualPlace && <p className="mt-1 text-xs text-[#7a4a00]">Start point you chose: <strong>{ui.manualPlace}</strong>. Distance and time are from there; the dot will not move until real GPS is available.</p>}
          <p className="mt-1 text-[11px] text-ink-muted">Road distance and typical-speed times — no live traffic.</p>
          {nav.puck?.headingKnown && nav.puck.bearing !== null && <p className="mt-1 text-xs text-ink-muted">Heading <strong className="text-pine">{abbr(nav.puck.bearing)}</strong>{ui.speedKmh ? ` · ${ui.speedKmh} km/h` : ""}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" className="min-h-11" onClick={ui.onOverview}>Overview</Button>
            <button type="button" onClick={ui.onToggleHeading} aria-pressed={headingUp} className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold text-pine">{headingUp ? "Heading up" : "North up"}</button>
            <button type="button" onClick={nav.toggleVoice} aria-pressed={nav.voice} aria-label={nav.voice ? "Mute voice guidance" : "Turn on voice guidance"} className="grid h-11 w-11 place-items-center rounded-full border border-line text-pine"><Glyph name={nav.voice ? "volumeOn" : "volumeOff"} size={20} /></button>
            <Button size="sm" variant="secondary" className="min-h-11" loading={nav.altLoading} loadingLabel="Finding routes…" onClick={nav.alternatives.length > 0 ? nav.closeOptions : nav.routeOptions}>{nav.alternatives.length > 0 ? "Hide routes" : "Other routes"}</Button>
          </div>
        </div>
      )}

      {nav.alternatives.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-line p-2" role="group" aria-label="Other routes">
          <p className="px-1 pb-1 text-xs text-ink-muted">You are still on your current route until you choose another.</p>
          <ul className="space-y-2">
            {nav.altChoices.map((c) => {
              const current = c.id === nav.selectedId || nav.routes[0]?.id === c.id;
              return (
                <li key={c.id}>
                  <button type="button" disabled={current} onClick={() => nav.choose(c.id)} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 text-left ${current ? "border-[#1a73e8] bg-[#e8f0fe]" : "border-line bg-white active:border-[#1a73e8]"}`}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-pine">{current ? "Current route" : "Use this route"}{c.via ? ` · ${c.via}` : ""}</span>
                      <span className="block text-xs text-ink-muted">{c.km} km{!current && (c.deltaMin !== 0 || c.deltaKm !== 0) ? ` · ${c.deltaMin > 0 ? `${c.deltaMin} min slower` : c.deltaMin < 0 ? `${Math.abs(c.deltaMin)} min faster` : "same time"}${c.deltaKm < 0 ? `, ${Math.abs(c.deltaKm)} km shorter` : c.deltaKm > 0 ? `, ${c.deltaKm} km longer` : ""}` : ""}</span>
                    </span>
                    <span className="shrink-0 font-mono text-lg font-semibold text-pine">{formatDuration(c.minutes)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Shell>
  );
}

function Shell({ floating, children }: { floating: boolean; children: React.ReactNode }) {
  return floating
    ? <div className="absolute inset-x-0 bottom-0 z-30 max-h-[60%] overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(0,0,0,.2)] md:inset-x-auto md:bottom-4 md:right-4 md:w-[26rem] md:rounded-3xl md:pb-4" role="region" aria-label="Navigation">{children}</div>
    : <section className="rounded-2xl border border-line bg-white p-4 sm:p-5" aria-label="Navigation">{children}</section>;
}
