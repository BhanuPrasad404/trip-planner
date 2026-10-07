"use client";

import { delayText, formatDistance, freshness, lastSeenText, summarizeDrive } from "@/lib/live";
import { distanceKm } from "@/lib/geo";
import { safeColor } from "@/lib/format";
import type { TripMember } from "@/lib/types";
import type { Drive, DriveTarget } from "@/lib/client/use-drive";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";

type DrivePanelProps = {
  drive: Drive;
  members: TripMember[];
  userId: string;
  /** The stops still ahead on the day being driven, in order. */
  stops: DriveTarget[];
  /** Typical time spent at a stop, in minutes (added between stops when working out arrival times). */
  stayMinutes: (stopId: string) => number;
  /** True when the day being driven is TODAY, so "behind plan" is meaningful. */
  comparePlan: boolean;
  dayLabel: string;
  /** Current time in ms; 0 until the browser clock is ready (keeps server and client output identical). */
  nowMs: number;
};

const toneClass = { ok: "bg-teal-light text-teal-ink", late: "bg-clay-light text-clay-ink", early: "bg-sky text-ink-muted" } as const;
const dotClass = { live: "bg-teal", recent: "bg-marigold", stale: "bg-line" } as const;

export function DrivePanel({ drive, members, userId, stops, stayMinutes, comparePlan, dayLabel, nowMs }: DrivePanelProps) {
  const { active, share, me, quality, error, route, members: live } = drive;

  const now = new Date(nowMs);
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const byId = new Map(stops.map((s) => [s.id, s]));
  const routeStops = route ? route.stopIds.map((id) => byId.get(id)).filter((s): s is DriveTarget => !!s) : [];
  const summary = route && me ? summarizeDrive(route.legs, routeStops, minuteOfDay, comparePlan, stayMinutes) : null;
  const delay = summary ? delayText(summary.next.delayMin) : null;

  const others = members.filter((m) => m.user_id !== userId);
  const sharingOthers = others.filter((m) => live[m.user_id]);

  return (
    <section aria-labelledby="drive-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="drive-heading" className="font-display text-lg font-semibold text-pine">Drive mode</h2>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-teal-light text-teal-ink" : "bg-sky text-ink-muted"}`}>
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${active ? "animate-pulse bg-teal" : "bg-line"}`} />
          {active ? "Driving" : "Not driving"}
        </span>
      </div>

      {error && <p role="alert" className="mt-3 rounded-xl border border-clay/30 bg-clay-light/70 px-3 py-2 text-sm font-medium text-clay-ink">{error}</p>}

      {!active ? (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-ink-muted">
            Start when you set off. You&apos;ll see where you are on the map, the road to your next stop, how far it is and when you&apos;ll arrive. Friends who are driving show up too.
          </p>
          <label className="mt-3 inline-flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" checked={share} onChange={(e) => drive.setShare(e.target.checked)} className="mt-1" />
            <span>Share my live location with this trip&apos;s members while I drive</span>
          </label>
          <div className="mt-3">
            <Button onClick={drive.start} className="w-full sm:w-auto"><span className="inline-flex items-center gap-1.5"><Glyph name="play" size={16} />Start drive</span></Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="rounded-2xl bg-pine p-4 text-white">
            {!me ? (
              <p className="text-sm text-white/85" role="status">Finding your location… allow location access if your browser asks.</p>
            ) : quality && !quality.usable ? (
              <div role="status">
                <p className="text-sm font-semibold">{quality.grade === "stale" ? "Waiting for a fresh position…" : "Your position is only approximate"}</p>
                <p className="mt-1 text-sm text-white/85">{quality.message}</p>
                <p className="mt-1 text-xs text-white/70">Exact distances and arrival times start as soon as the position is precise.</p>
              </div>
            ) : !summary ? (
              <p className="text-sm text-white/85">
                {stops.length === 0 ? `No stops left on ${dayLabel}. Add or schedule a stop to see distance and arrival time.` : "Working out the route…"}
                {me.speedKmh != null && <span className="ml-2 font-mono">{me.speedKmh} km/h</span>}
              </p>
            ) : (
              <>
                <p className="font-mono text-xs uppercase tracking-widest text-white/70">Next stop</p>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words font-display text-xl font-semibold leading-tight">{summary.next.name}</p>
                  {me.speedKmh != null && (
                    <p className="shrink-0 text-right font-mono text-sm text-white/85">
                      <span className="text-xl font-semibold text-white">{me.speedKmh}</span> km/h
                    </p>
                  )}
                </div>
                <p className="mt-2 font-mono text-sm">
                  <span className="text-2xl font-semibold">{formatDistance(summary.next.km)}</span>
                  <span className="text-white/80"> · {summary.next.minutes} min · arrive </span>
                  <span className="text-lg font-semibold">{summary.next.eta}</span>
                </p>
                {delay && <p className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${toneClass[delay.tone]}`}>{delay.text}</p>}
              </>
            )}
          </div>

          {me && quality?.usable && <p className="text-xs text-ink-muted">Position: {quality.message}</p>}

          {summary && summary.stops.length > 1 && (
            <div>
              <h3 className="text-sm font-semibold text-pine">Coming up on {dayLabel}</h3>
              <ol className="mt-1 divide-y divide-line text-sm">
                {summary.stops.slice(1).map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 break-words font-medium">{s.name}</span>
                    <span className="shrink-0 font-mono text-xs text-ink-muted">{formatDistance(s.km)} · {s.eta}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-xs text-ink-muted">
                {formatDistance(summary.totalKm)} of driving left · last stop about {summary.finishEta}. Arrival times include a typical stay at each stop.
              </p>
            </div>
          )}
          {route?.source === "estimate" && (
            <p className="text-xs text-clay-ink">These are estimates: the road-routing service didn&apos;t answer, so times are straight-line guesses.</p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={share} onChange={(e) => drive.setShare(e.target.checked)} />
              Sharing my location with the group
            </label>
            <Button variant="secondary" onClick={drive.stop} className="w-full sm:w-auto"><span className="inline-flex items-center gap-1.5"><Glyph name="stop" size={16} />Stop drive</span></Button>
          </div>
          <p className="text-xs text-ink-muted">Keep this screen open. Browsers pause location when the phone is locked, so we ask your phone to keep the screen on while you drive.</p>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-sm font-semibold text-pine">Your group {sharingOthers.length > 0 ? `· ${sharingOthers.length} sharing` : ""}</h3>
          <ul className="mt-1 divide-y divide-line">
            {others.map((m) => {
              const l = live[m.user_id];
              const fresh = l ? freshness(l.updated_at, nowMs) : null;
              const away = l && me ? distanceKm(me, l) : null;
              return (
                <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: safeColor(m.avatar_color), opacity: fresh === "stale" || !l ? 0.5 : 1 }}
                  >
                    {m.display_name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{m.display_name ?? "Traveler"}</p>
                    <p className="text-xs text-ink-muted">
                      {l && fresh ? (
                        <>
                          <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${dotClass[fresh]}`} />
                          {fresh === "live" ? "Live" : `Last seen ${lastSeenText(l.updated_at, nowMs)}`}
                          {away != null && ` · ${formatDistance(away)} from you`}
                          {l.speed_kmh != null && l.speed_kmh >= 3 && ` · ${Math.round(l.speed_kmh)} km/h`}
                        </>
                      ) : (
                        "Not sharing"
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
