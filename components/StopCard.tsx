"use client";

import { dbTime12 } from "@/lib/travel/clock";
import { useState } from "react";
import { CATEGORIES, type PlaceCategory } from "@/lib/categories";
import { formatDuration } from "@/lib/format";
import type { GoScore } from "@/lib/goscore";
import type { Place, SeasonStatus } from "@/lib/types";
import type { PinWarning } from "@/lib/pin-check";
import type { VoteSummary } from "@/lib/votes";
import type { ReportView } from "@/lib/reports";
import { GoScoreBadge } from "./GoScoreBadge";
import { PlaceReports } from "./PlaceReports";
import { PlaceSearch, type PickedPlace } from "./PlaceSearch";
import { SeasonBadge } from "./SeasonBadge";
import { WeatherChip } from "./WeatherChip";
import type { WeatherVisual } from "@/lib/travel/weather-visual";
import { Button } from "./ui/Button";
import { Menu, MenuItem, MenuLabel } from "./ui/Menu";
import { Spinner } from "@/components/ui/Spinner";
import { Glyph, CategoryGlyph } from "@/components/ui/Glyph";
import { PlacePhoto, PhotoCredit } from "@/components/ui/PlacePhoto";
import type { PlacePhoto as PlacePhotoData } from "@/lib/place-photos";

type StopCardProps = {
  place: Place;
  /** A verified real photo of this place (never a stand-in). Absent = the card looks exactly as before. */
  photo?: PlacePhotoData | null;
  status: SeasonStatus;
  category: PlaceCategory;
  score: GoScore | null;
  /** The day the Go score is FOR, e.g. "Tomorrow · Wed 7 Oct". */
  scoreFor?: string;
  seasonReason?: string | null;
  /** Days this stop can be moved to (the menu adds an "Ideas" option when it's scheduled). */
  moveDays: number[];
  votes?: VoteSummary;
  /** Set when this pin is suspiciously far from the trip area. */
  farWarning?: PinWarning;
  seasonSource?: { confidence?: string | null; urls?: string[] | null };
  /** Where the trip is going — keeps "fix location" searches local. */
  near?: { lat: number; lng: number } | null;
  onMove?: (placeId: string, day: number | null) => void;
  onRemove?: (placeId: string) => void;
  onVote?: (placeId: string, vote: -1 | 0 | 1) => void;
  onRelocate?: (placeId: string, to: PickedPlace) => void;
  onAlternatives?: (place: Place) => void;
  /** Trip mode: mark this stop done / skipped / back to planned. */
  onStatus?: (placeId: string, status: "planned" | "done" | "skipped") => void;
  /** Community updates for this place (photos, conditions) and what's needed to post one. */
  reports?: ReportView[];
  reportCtx?: { userId: string; now: Date; onChanged: () => void };
  /** A request for this stop is running (shows "Saving…"). */
  busy?: boolean;
  /** Open the "more actions" menu on first render (tests and screenshots). */
  menuOpen?: boolean;
  /** The weather at this stop on its day, from real data (see lib/travel/weather-visual.ts). Fair weather is not shown. */
  weather?: WeatherVisual | null;
  /** This stop is the one picked on the map (or by "Show on the map"). */
  selected?: boolean;
  /** Fly the map to this stop and open its details. */
  onShowOnMap?: (placeId: string) => void;
};

export function StopCard({
  place, photo, status, category, score, scoreFor, seasonReason, moveDays, votes, near, farWarning, seasonSource,
  onMove, onRemove, onVote, onRelocate, onAlternatives, onStatus, reports, reportCtx, busy, menuOpen, selected, onShowOnMap, weather,
}: StopCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [target, setTarget] = useState<PickedPlace | null>(null);
  const cat = CATEGORIES[category];
  const scheduled = place.day_number !== null;
  const done = place.status === "done";
  const skipped = place.status === "skipped";
  const finished = done || skipped;
  const needsAttention = !finished && (status === "wrong_season" || score?.tone === "poor");
  const mine = votes?.mine ?? 0;
  const time = dbTime12(place.arrival_time);
  const moveOptions = [...(scheduled ? [{ key: "ideas", label: "Ideas", day: null as number | null }] : []), ...moveDays.filter((d) => d !== place.day_number).map((d) => ({ key: String(d), label: `Day ${d}`, day: d as number | null }))];
  const hasMenu = !!(onMove || onRelocate || onRemove);

  const driveLine = scheduled && place.drive_minutes != null && place.drive_minutes > 0 && (
    <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
      <Glyph name="car" size={13} />
      {formatDuration(place.drive_minutes)}{place.drive_km != null && ` · ${Math.round(place.drive_km)} km`} from previous point
    </p>
  );

  const card = (
    <article
      className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(11,61,58,0.06)] transition-shadow hover:shadow-md sm:p-5 ${selected ? "ring-2 ring-teal ring-offset-2" : ""} ${
        done ? "border-teal/40 bg-teal-light/30" : skipped ? "border-line bg-sky/50" : needsAttention ? "border-clay/40" : "border-line"
      }`}
    >
      {/* Title row: what it is, where it is, and the menu for everything occasional */}
      <header className="flex items-start gap-3">
        {photo && <PlacePhoto photo={photo} name={place.name} sizes="64px" className={`h-16 w-16 ${skipped ? "opacity-60" : ""}`} fallback={<CategoryGlyph category={category} size={22} />} />}
        <div className="min-w-0 flex-1">
          <h3 className={`break-words text-[17px] font-semibold leading-snug text-pine ${skipped ? "text-ink-muted" : ""} ${done ? "decoration-teal/60" : ""}`}>
            {!scheduled && <CategoryGlyph category={category} size={17} className="mr-1.5 inline align-text-bottom text-teal" />}
            {place.name}
            <span className="sr-only"> ({cat.label})</span>
          </h3>
          {driveLine}
          {photo && <PhotoCredit photo={photo} className="mt-1" />}
        </div>
        {busy && (
          <span role="status" className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-sky px-2.5 py-1 text-xs font-semibold text-ink-muted">
            <Spinner size={12} />Saving…
          </span>
        )}
        {onShowOnMap && (
          <button type="button" onClick={() => onShowOnMap(place.id)} aria-label={`Show ${place.name} on the map`} title="Show on the map" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-sky hover:text-pine">
            <Glyph name="pin" size={19} />
          </button>
        )}
        {hasMenu && (
          <Menu label={`More actions for ${place.name}`} title={place.name} defaultOpen={menuOpen} onOpenChange={(o) => { if (!o) setConfirming(false); }}>
            {(close) =>
              confirming ? (
                <div className="p-3">
                  <p className="font-semibold text-pine">Remove “{place.name}”?</p>
                  <p className="mt-1 text-sm text-ink-muted">It is taken off the trip for everyone in the group.</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>Keep it</Button>
                    <Button size="sm" variant="danger" className="flex-1" onClick={() => { close(); setConfirming(false); onRemove?.(place.id); }}>Yes, remove</Button>
                  </div>
                </div>
              ) : (
                <>
                  {onMove && moveOptions.length > 0 && (
                    <div>
                      <MenuLabel>{scheduled ? "Move to" : "Schedule on"}</MenuLabel>
                      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                        {moveOptions.map((o) => (
                          <button key={o.key} type="button" role="menuitem" onClick={() => { close(); onMove(place.id, o.day); }} className="min-h-10 rounded-full border border-line bg-white px-3.5 text-sm font-semibold text-pine hover:border-teal hover:bg-teal-light">
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {onRelocate && <MenuItem icon="pin" onSelect={() => { close(); setFixing(true); }}>Wrong location? Fix the pin<span className="sr-only"> for {place.name}</span></MenuItem>}
                  {onRemove && (
                    <>
                      <div role="separator" className="my-1 h-px bg-line" />
                      <MenuItem icon="trash" tone="danger" onSelect={() => setConfirming(true)}>Remove from trip<span className="sr-only"> {place.name}</span></MenuItem>
                    </>
                  )}
                </>
              )
            }
          </Menu>
        )}
      </header>

      {(done || skipped) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {done && <span className="inline-flex items-center gap-1.5 rounded-full bg-teal px-2.5 py-1 text-xs font-semibold text-white"><Glyph name="check" size={12} />Done</span>}
          {skipped && <span className="inline-flex items-center gap-1.5 rounded-full bg-line px-2.5 py-1 text-xs font-semibold text-ink-muted">Skipped</span>}
        </div>
      )}

      {/* What matters right now. Short, and only when there is something to say. Everything else is under "More". */}
      <div className="mt-2.5 space-y-2 empty:hidden">
      {farWarning && (
        <div role="note" className="flex items-start gap-2.5 rounded-xl bg-clay-light px-3 py-2.5 text-sm text-clay-ink">
          <Glyph name="warn" size={16} className="mt-0.5" />
          <p className="min-w-0 flex-1"><strong>{Math.round(farWarning.km)} km from {farWarning.anchorLabel} — is this pin right?</strong> Use “Wrong location?” in the menu to fix it.</p>
        </div>
      )}
      {needsAttention && onAlternatives && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-clay/30 bg-clay-light/60 px-3 py-2.5">
          <p className="text-sm font-semibold text-clay-ink">Timing looks poor for your dates.</p>
          <Button size="sm" variant="secondary" onClick={() => onAlternatives(place)}><Glyph name="sparkles" size={15} />Find alternatives</Button>
        </div>
      )}

        {weather && weather.basis === "forecast" && weather.kind !== "fair" && <WeatherChip v={weather} />}
      </div>

      {/* The few things you do all the time */}
      {((onStatus && scheduled) || (!scheduled && onMove)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={`Progress for ${place.name}`}>
{onStatus && scheduled && (finished ? (
            <Button size="sm" variant="secondary" className="max-sm:min-h-11" loading={busy} onClick={() => onStatus(place.id, "planned")}>
              <Glyph name="uturn" size={15} />Undo<span className="sr-only"> {place.status} for {place.name}</span>
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" className="max-sm:min-h-11" disabled={busy} onClick={() => onStatus(place.id, "skipped")}>
                <Glyph name="skip" size={15} />Skip<span className="sr-only"> {place.name}</span>
              </Button>
              <Button size="sm" className="max-sm:min-h-11" disabled={busy} onClick={() => onStatus(place.id, "done")}>
                <Glyph name="check" size={16} />Done<span className="sr-only"> with {place.name}</span>
              </Button>
            </>
          ))}
          {!scheduled && onMove && moveOptions.length > 0 && (
            <Menu
              label={`Schedule ${place.name} on a day`}
              title="Schedule on"
              triggerClassName="inline-flex min-h-11 items-center gap-2 rounded-xl bg-marigold px-4 text-sm font-bold text-pine transition-colors hover:bg-[#f0b254] aria-expanded:bg-[#d9942d] sm:min-h-10"
              trigger={<><Glyph name="calendar" size={16} />Schedule on…<Glyph name="down" size={14} /></>}
            >
              {(close) => (
                <div className="flex flex-wrap gap-1.5 p-2">
                  {moveOptions.map((o) => (
                    <button key={o.key} type="button" role="menuitem" onClick={() => { close(); onMove(place.id, o.day); }} className="min-h-11 rounded-full border border-line bg-white px-4 text-sm font-semibold text-pine hover:border-teal hover:bg-teal-light">
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </Menu>
          )}
        </div>
      )}

      <details className="group mt-3 border-t border-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-ink-muted [&::-webkit-details-marker]:hidden">
          <span>More about this place</span>
          <Glyph name="down" size={16} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 pb-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeasonBadge status={status} />
            {place.source_url && (
              <a href={place.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-teal-ink transition-colors hover:border-teal hover:bg-teal-light">
                <Glyph name="external" size={12} />Original post<span className="sr-only"> for {place.name} (opens in a new tab)</span>
              </a>
            )}
            {place.source_type === "ai_suggestion" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-marigold-light px-2.5 py-1 text-xs font-semibold text-[#7a4a00]"><Glyph name="sparkles" size={12} />AI suggestion</span>
            )}
          </div>
          {place.address && <p className="flex items-start gap-1.5 break-words text-sm text-ink-muted"><Glyph name="pin" size={14} className="mt-0.5" />{place.address}</p>}
          {score && <GoScoreBadge score={score} forDay={scoreFor} />}
          {weather && weather.basis === "typical" && weather.kind !== "fair" && <p className="text-sm text-ink-muted"><strong className="text-pine">{weather.headline}.</strong> {weather.detail}.</p>}
          {status === "wrong_season" && seasonReason && <p className="text-sm leading-relaxed text-ink-muted">{seasonReason}</p>}
          {place.notes && <p className="rounded-xl bg-sky/70 px-3 py-2 text-sm leading-relaxed text-ink">{place.notes}</p>}
          {seasonSource?.urls?.[0] && status !== "unknown" && (
            <p className="text-xs text-ink-muted">
              Season info: {seasonSource.confidence === "researched" ? "researched" : "draft"} ·{" "}
              <a href={seasonSource.urls[0]} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                {new URL(seasonSource.urls[0]).hostname.replace(/^www\./, "")}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {seasonSource.urls.length > 1 && ` +${seasonSource.urls.length - 1} more`}
            </p>
          )}
          {onVote && (
            <div role="group" aria-label={`Group vote for ${place.name}`} className="inline-flex overflow-hidden rounded-full border border-line bg-white">
              {([[1, "thumbUp", "Up"], [-1, "thumbDown", "Down"]] as const).map(([v, icon, word]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={mine === v}
                  disabled={busy}
                  onClick={() => onVote(place.id, mine === v ? 0 : v)}
                  className={`inline-flex min-h-11 items-center gap-1.5 px-4 text-sm font-semibold transition-colors disabled:opacity-60 sm:min-h-10 ${v === -1 ? "border-l border-line" : ""} ${
                    mine === v ? (v === 1 ? "bg-teal-light text-teal-ink" : "bg-clay-light text-clay-ink") : "text-ink-muted hover:bg-sky"
                  }`}
                >
                  <Glyph name={icon} size={16} />
                  <span className="font-mono">{v === 1 ? votes?.up ?? 0 : votes?.down ?? 0}</span>
                  <span className="sr-only"> {word}vote</span>
                </button>
              ))}
            </div>
          )}
          {reportCtx && (
            <PlaceReports
              place={{ id: place.id, name: place.name, lat: place.lat, lng: place.lng }}
              reports={reports ?? []}
              userId={reportCtx.userId}
              now={reportCtx.now}
              onChanged={reportCtx.onChanged}
            />
          )}
        </div>
      </details>

      {fixing && onRelocate && (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-sky/60 p-3.5">
          <PlaceSearch
            label={`Where is “${place.name}” really?`}
            value={target}
            onChange={setTarget}
            near={near}
            placeholder={`Search again, e.g. ${place.name}, ${place.address?.split(",").slice(-2, -1)[0]?.trim() || "town name"}`}
            hint="Pick the correct match and we'll move the pin. You can also add the town to your search."
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setTarget(null); setFixing(false); }}>Cancel</Button>
            {target && (
              <Button size="sm" disabled={busy} onClick={() => { onRelocate(place.id, target); setTarget(null); setFixing(false); }}>
                Move the pin here
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );

  // Ideas (not on a day yet) are a simple stack of cards; scheduled stops sit on a timeline with their time and the drive between them.
  if (!scheduled) return <li id={`stop-${place.id}`} className="scroll-mt-24 pb-3 last:pb-0">{card}</li>;

  const rail = done ? "bg-teal text-white" : skipped ? "bg-line text-ink-muted" : needsAttention ? "bg-clay-light text-clay-ink" : "bg-teal-light text-teal-ink";
  return (
    <li id={`stop-${place.id}`} className="group grid scroll-mt-24 grid-cols-[3rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-x-4">
      <div className="flex flex-col items-center">
        <span className={`mt-3.5 grid h-10 w-10 place-items-center rounded-full ring-4 ring-white ${rail}`}>
          {done ? <Glyph name="check" size={18} strokeWidth={2.6} /> : <CategoryGlyph category={category} size={18} />}
        </span>
        <span className="mt-1.5 text-center font-mono text-[11px] font-medium leading-tight text-ink-muted">
          {time ?? <span title="No arrival time yet. Use Plan my trip to set times." className="text-[10px] uppercase tracking-wide">No time</span>}
        </span>
        <span aria-hidden="true" className="mt-2 w-0.5 flex-1 rounded-full bg-line group-last:hidden" />
      </div>
      <div className="min-w-0 pb-5 group-last:pb-1">
        {card}
      </div>
    </li>
  );
}
