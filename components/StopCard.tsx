"use client";

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
import { Button } from "./ui/Button";
import { Glyph, CategoryGlyph } from "@/components/ui/Glyph";

type StopCardProps = {
  place: Place;
  status: SeasonStatus;
  category: PlaceCategory;
  score: GoScore | null;
  /** The day the Go score is FOR, e.g. "Tomorrow · Wed 7 Oct". */
  scoreFor?: string;
  seasonReason?: string | null;
  /** Days this stop can be moved to (the UI adds an "Ideas" option when it's scheduled). */
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
  busy?: boolean;
};

const linkBtn = "min-h-9 font-semibold text-ink-muted underline underline-offset-2 hover:text-teal-ink";

export function StopCard({
  place, status, category, score, scoreFor, seasonReason, moveDays, votes, near, farWarning, seasonSource,
  onMove, onRemove, onVote, onRelocate, onAlternatives, onStatus, reports, reportCtx, busy,
}: StopCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [target, setTarget] = useState<PickedPlace | null>(null);
  const cat = CATEGORIES[category];
  const scheduled = place.day_number !== null;
  const finished = place.status === "done" || place.status === "skipped";
  const needsAttention = !finished && (status === "wrong_season" || score?.tone === "poor");
  const mine = votes?.mine ?? 0;

  return (
    <li className={`border-b border-line py-4 last:border-b-0 ${finished ? "opacity-70" : ""}`}>
      {scheduled && place.drive_minutes != null && place.drive_minutes > 0 && (
        <p className="mb-2 ml-[3.75rem] inline-flex items-center gap-1.5 rounded-full bg-sky px-2.5 py-1 text-xs font-medium text-ink-muted">
          <Glyph name="car" size={14} />
          {formatDuration(place.drive_minutes)}
          {place.drive_km != null && ` · ${Math.round(place.drive_km)} km`} from previous point
        </p>
      )}

      <div className="flex gap-3">
        <div className="w-12 shrink-0 pt-0.5 font-mono text-xs text-ink-muted">{place.arrival_time?.slice(0, 5) ?? <span title="No arrival time yet — run Auto-plan route" className="text-[10px] uppercase tracking-wide">No time</span>}</div>

        <div className="min-w-0 flex-1">
          <h3 className={`break-words text-base font-semibold leading-snug ${place.status === "done" ? "line-through decoration-teal/60" : ""}`}>
            <CategoryGlyph category={category} size={17} className="mr-1.5 inline align-text-bottom text-teal" />
            {place.name}
            <span className="sr-only"> ({cat.label})</span>
          </h3>
          {place.address && <p className="mt-0.5 flex items-start gap-1.5 break-words text-sm text-ink-muted"><Glyph name="pin" size={14} className="mt-0.5" />{place.address}</p>}
          {farWarning && (
            <p className="mt-1 text-sm font-semibold text-clay-ink">
              <Glyph name="warn" size={14} className="mr-1 inline align-text-bottom" />{Math.round(farWarning.km)} km from {farWarning.anchorLabel} — is this pin right? Use “Wrong location?” to fix it.
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {place.status === "done" && <span className="rounded-full bg-teal-light px-2.5 py-1 text-xs font-semibold text-teal-ink"><Glyph name="check" size={12} className="mr-1 inline align-text-bottom" />Done</span>}
            {place.status === "skipped" && <span className="rounded-full bg-sky px-2.5 py-1 text-xs font-semibold text-ink-muted">Skipped</span>}
            <SeasonBadge status={status} />
            {place.source_type === "ai_suggestion" && (
              <span className="rounded-full bg-marigold-light px-2.5 py-1 text-xs font-semibold text-[#7a4a00]"><Glyph name="sparkles" size={12} className="mr-1 inline align-text-bottom" />AI suggestion</span>
            )}
          </div>

          {score && <GoScoreBadge score={score} forDay={scoreFor} />}

          {status === "wrong_season" && seasonReason && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{seasonReason}</p>}
          {seasonSource?.urls?.[0] && status !== "unknown" && (
            <p className="mt-1 text-xs text-ink-muted">
              Season info: {seasonSource.confidence === "researched" ? "researched" : "draft"} ·{" "}
              <a href={seasonSource.urls[0]} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                {new URL(seasonSource.urls[0]).hostname.replace(/^www\./, "")}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {seasonSource.urls.length > 1 && ` +${seasonSource.urls.length - 1} more`}
            </p>
          )}
          {place.notes && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{place.notes}</p>}

          {onVote && (
            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`Group vote for ${place.name}`}>
              {([[1, "thumbUp", "Up"], [-1, "thumbDown", "Down"]] as const).map(([v, icon, word]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={mine === v}
                  disabled={busy}
                  onClick={() => onVote(place.id, mine === v ? 0 : v)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${
                    mine === v ? "border-teal bg-teal-light text-teal-ink" : "border-line bg-white text-ink-muted hover:border-teal"
                  }`}
                >
                  <Glyph name={icon} size={16} />
                  {v === 1 ? votes?.up ?? 0 : votes?.down ?? 0}
                  <span className="sr-only"> {word}vote</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {place.source_url && (
              <a href={place.source_url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-teal-ink underline underline-offset-2">
                View original<span className="sr-only"> link for {place.name} (opens in a new tab)</span>
              </a>
            )}

            {onStatus && scheduled && (
              place.status === "done" || place.status === "skipped" ? (
                <button type="button" disabled={busy} onClick={() => onStatus(place.id, "planned")} className={linkBtn}>
                  Undo<span className="sr-only"> {place.status} for {place.name}</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-2" role="group" aria-label={`Progress for ${place.name}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onStatus(place.id, "done")}
                    className="inline-flex min-h-9 items-center rounded-full border border-teal bg-teal-light px-3 text-sm font-semibold text-teal-ink hover:bg-white disabled:opacity-60"
                  >
                    <Glyph name="check" size={15} className="mr-1.5" />Done<span className="sr-only"> with {place.name}</span>
                  </button>
                  <button type="button" disabled={busy} onClick={() => onStatus(place.id, "skipped")} className={linkBtn}>
                    Skip<span className="sr-only"> {place.name}</span>
                  </button>
                </span>
              )
            )}

            {onAlternatives && needsAttention && (
              <button type="button" onClick={() => onAlternatives(place)} className="min-h-9 font-semibold text-clay-ink underline underline-offset-2">
                <Glyph name="sparkles" size={15} className="mr-1.5" />Find alternatives
              </button>
            )}

            {onMove && (
              <span className="inline-flex items-center gap-1.5">
                <label htmlFor={`move-${place.id}`} className="sr-only">Move {place.name} to</label>
                <select
                  id={`move-${place.id}`}
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) onMove(place.id, v === "ideas" ? null : Number(v));
                  }}
                  className="min-h-9 rounded-lg border border-line bg-white px-2 text-sm font-semibold text-ink-muted"
                >
                  <option value="">{scheduled ? "Move to…" : "Schedule on…"}</option>
                  {scheduled && <option value="ideas">Ideas</option>}
                  {moveDays.filter((d) => d !== place.day_number).map((d) => (
                    <option key={d} value={d}>Day {d}</option>
                  ))}
                </select>
              </span>
            )}

            {onRelocate && (
              <button type="button" onClick={() => setFixing((f) => !f)} aria-expanded={fixing} className={linkBtn}>
                <Glyph name="pin" size={15} className="mr-1.5" />Wrong location?<span className="sr-only"> Fix the pin for {place.name}</span>
              </button>
            )}

            {onRemove &&
              (confirming ? (
                <span className="inline-flex items-center gap-3" role="group" aria-label={`Confirm removing ${place.name}`}>
                  <button type="button" disabled={busy} onClick={() => onRemove(place.id)} className="min-h-9 font-semibold text-clay-ink underline underline-offset-2 disabled:opacity-60">
                    {busy ? "Removing…" : "Yes, remove"}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={linkBtn}>Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className={`${linkBtn} hover:text-clay-ink`}>
                  Remove<span className="sr-only"> {place.name}</span>
                </button>
              ))}
          </div>

          {reportCtx && (
            <PlaceReports
              place={{ id: place.id, name: place.name, lat: place.lat, lng: place.lng }}
              reports={reports ?? []}
              userId={reportCtx.userId}
              now={reportCtx.now}
              onChanged={reportCtx.onChanged}
            />
          )}

          {fixing && onRelocate && (
            <div className="mt-3 space-y-3 rounded-xl border border-line bg-sky/60 p-3">
              <PlaceSearch
                label={`Where is “${place.name}” really?`}
                value={target}
                onChange={setTarget}
                near={near}
                placeholder={`Search again, e.g. ${place.name}, ${place.address?.split(",").slice(-2, -1)[0]?.trim() || "town name"}`}
                hint="Pick the correct match and we'll move the pin. You can also add the town to your search."
              />
              {target && (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button size="sm" variant="ghost" onClick={() => { setTarget(null); setFixing(false); }}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      onRelocate(place.id, target);
                      setTarget(null);
                      setFixing(false);
                    }}
                  >
                    Move the pin here
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
