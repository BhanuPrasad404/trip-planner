"use client";

// "Your trip activity": what really happened on this trip, in plain words and in order. It is a diary, not a log: the app's own
// bookkeeping is left out (lib/trip/journey.ts, buildTimeline), nothing is invented, and a mistake is corrected with a new line (the
// original stays, marked), never by deleting history.
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TimePicker } from "@/components/ui/TimePicker";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";
import { dateText, retimeTo, timeText, type Certainty, type JourneyKind, type TimelineRow } from "@/lib/trip/journey";

type Props = {
  rows: TimelineRow[];
  /** Put right one of the traveller's OWN lines: it didn't happen (void) or it had this time (retime). Absent: no such control. */
  correct?: (target: string, action: "void" | "retime", at?: string) => Promise<unknown>;
  problem?: string | null;
  /** Events made on this phone that are not sent yet. */
  waiting: number;
  /** False: the database has no journey history yet. Said plainly. */
  stored: boolean | null;
  /** Lines kept in the history that did not fit the order of events. */
  ignored: number;
  offsetMin: number;
};

const ICON: Partial<Record<JourneyKind, GlyphName>> = {
  departed: "navigate", resumed: "navigate", rest_ended: "navigate", paused: "pin", rest_started: "moon", approached: "locate", arrived: "pin", passed_through: "arrow", exploring_started: "compass",
  visit_completed: "checkCircle", visit_skipped: "skip", visit_corrected: "refresh", arrival_corrected: "refresh", unplanned_stop_added: "plus", revision_proposed: "chat", revision_approved: "wand", revision_rejected: "close", manual_correction: "refresh",
};
const WHO: Record<Certainty, string> = { gps: "Noticed from your phone's location", manual: "You told us", system: "Added automatically", inferred: "Worked out, not recorded", pending: "Waiting to send" };
const SHOWN = 6;

export function TripActivity(p: Props) {
  const [all, setAll] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixTime, setFixTime] = useState("");
  const [fixBusy, setFixBusy] = useState(false);
  const hhmm = (iso: string) => { const d = new Date(Date.parse(iso) + p.offsetMin * 60_000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
  const fix = async (row: TimelineRow, action: "void" | "retime") => {
    if (!p.correct) return;
    const at = action === "retime" ? retimeTo(row.at, fixTime, p.offsetMin) : null;
    if (action === "retime" && !at) return;
    setFixBusy(true);
    await p.correct(row.key, action, at ?? undefined);
    setFixBusy(false); setFixing(null);
  };

  // Newest first reads best on a phone; each day's first line carries its date.
  const rows = [...p.rows].reverse();
  const list = all ? rows : rows.slice(0, SHOWN);
  const dated = list.map((r, i) => { const date = dateText(Date.parse(r.at), p.offsetMin); return { r, date, head: i === 0 || date !== dateText(Date.parse(list[i - 1].at), p.offsetMin) }; });

  return (
    <section aria-labelledby="activity-heading" className="rounded-3xl border border-line bg-white p-4 sm:p-5" data-testid="trip-activity">
      <h2 id="activity-heading" className="font-display text-xl font-semibold text-pine">Your trip activity</h2>
      <p className="mt-0.5 text-sm text-ink-muted">What has happened on this trip so far, saved with the time it happened.</p>

      {p.waiting > 0 && <p role="status" className="mt-2 text-xs font-semibold text-marigold-ink">{p.waiting === 1 ? "1 update is" : `${p.waiting} updates are`} saved on this phone and will be sent when you&apos;re back online.</p>}
      {p.problem && p.correct && <p role="alert" className="mt-2 break-words text-xs font-semibold text-clay-ink">{p.problem}</p>}
      {p.stored === false && <p className="mt-2 text-xs text-ink-muted">Your activity can&apos;t be saved to the trip yet, so it only shows on this phone. Nothing is lost.</p>}

      {p.rows.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-sky px-4 py-3 text-sm text-ink-muted">Nothing yet. When you start your trip, reach a stop or add one of your own, it appears here.</p>
      ) : (
        <ol className="mt-3 space-y-0">
          {dated.map(({ r, date, head }) => (
            <li key={r.key} className="min-w-0">
              {head && <p className="pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-ink-muted">{date}</p>}
              <div className="flex min-w-0 gap-3 py-2">
                <span aria-hidden="true" className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${r.certainty === "inferred" ? "bg-sky text-ink-muted" : "bg-teal-light text-teal-ink"}`}><Glyph name={(r.kind && ICON[r.kind]) || "pin"} size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`break-words text-sm font-semibold ${r.certainty === "inferred" ? "italic text-ink-muted" : "text-pine"}`}>{r.member && <span className="font-normal text-ink-muted">{r.member}: </span>}{r.label}</p>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-muted">{timeText(r.at, p.offsetMin)}</span>
                  </div>
                  {r.detail && <p className="break-words text-xs text-ink-muted">{r.detail}</p>}
                  <p className="text-[11px] text-ink-muted">{WHO[r.certainty]}</p>
                  {r.note && <p className="break-words text-xs text-clay-ink">{r.note}</p>}
                  {p.correct && r.own && r.kind && !r.corrected && r.certainty !== "pending" && r.certainty !== "inferred" && (
                    fixing === r.key ? (
                      <div className="mt-1 space-y-2 rounded-xl bg-sky p-2.5">
                        <div><label htmlFor={`fix-${r.key}`} className="block text-sm font-semibold text-pine">What time was it really?</label><div className="mt-1"><TimePicker id={`fix-${r.key}`} label="What time was it really?" value={fixTime} onChange={setFixTime} /></div></div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => void fix(r, "retime")} loading={fixBusy} loadingLabel="Saving…" disabled={!fixTime} className="min-h-11">Save the time</Button>
                          <Button size="sm" variant="secondary" onClick={() => void fix(r, "void")} disabled={fixBusy} className="min-h-11">This didn&apos;t happen</Button>
                          <Button size="sm" variant="ghost" onClick={() => setFixing(null)} disabled={fixBusy} className="min-h-11">Cancel</Button>
                        </div>
                        <p className="text-xs text-ink-muted">The original stays in your history, marked as corrected.</p>
                      </div>
                    ) : <button type="button" onClick={() => { setFixing(r.key); setFixTime(hhmm(r.at)); }} className="min-h-11 text-xs font-semibold text-teal-ink underline underline-offset-2">Correct this</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {rows.length > SHOWN && <div className="mt-1"><Button size="sm" variant="ghost" className="min-h-11" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</Button></div>}
      {p.ignored > 0 && <p className="mt-2 text-xs text-ink-muted">{p.ignored === 1 ? "One update" : `${p.ignored} updates`} didn&apos;t fit the order of events and {p.ignored === 1 ? "was" : "were"} kept in the history without changing anything.</p>}
    </section>
  );
}
