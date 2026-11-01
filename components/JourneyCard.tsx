"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { TextField } from "@/components/ui/Field";
import type { RecordOptions } from "@/lib/client/use-journey";
import { dateText, retimeTo, timeText, type Certainty, type Journey, type JourneyKind, type TimelineRow } from "@/lib/trip/journey";

type Props = {
  journey: Journey;
  actions: JourneyKind[];
  rows: TimelineRow[];
  record: (kind: JourneyKind, o: RecordOptions) => Promise<"saved" | "queued" | "failed">;
  /** What to attach to an event: a real position reading (its accuracy, and where the traveller is, by name) or nothing (by hand). */
  fix: RecordOptions;
  /** Events made on this phone that are not sent yet. */
  waiting: number;
  /** False: the database has no journey history yet. Said plainly, nothing is pretended. */
  stored: boolean | null;
  closed: boolean;
  offsetMin: number;
  /**
   * "I visited somewhere else": a stop the traveller chose on the way, outside the plan. `add` saves it to the journey's history (the plan is
   * not touched). `addToPlan` is offered afterwards only when there is a precise position to place it at; it adds it as the next stop and
   * marks nothing done. Absent: no such control.
   */
  /** Put right one of the traveller's OWN events: it didn't happen (void), or it really had this time (retime). The original stays, marked. Absent: no such control. */
  correct?: (target: string, action: "void" | "retime", at?: string) => Promise<unknown>;
  /** Why the last change was refused (shown next to the controls). */
  problem?: string | null;
  unplanned?: { add: (name: string) => Promise<unknown>; addToPlan: ((name: string) => Promise<unknown>) | null; dayLabel: string };
};

const BUTTONS: Record<JourneyKind, { label: string; glyph: "navigate" | "pin" | "check" | "flag"; primary?: boolean } | undefined> = {
  departed: { label: "I've left", glyph: "navigate", primary: true },
  paused: { label: "Pause", glyph: "pin" },
  resumed: { label: "Back on the road", glyph: "navigate", primary: true },
  rest_started: { label: "Stop to rest", glyph: "pin" },
  rest_ended: { label: "Back on the road", glyph: "navigate", primary: true },
  approached: undefined, arrived: undefined, passed_through: undefined, exploring_started: undefined, visit_completed: undefined, visit_skipped: undefined, visit_corrected: undefined,
  arrival_corrected: undefined, unplanned_stop_added: undefined, revision_proposed: undefined, revision_approved: undefined, revision_rejected: undefined, manual_correction: undefined,
};

const CERTAINTY: Record<Certainty, string> = { gps: "From your phone's location", manual: "You said", system: "Automatic", inferred: "Worked out, not recorded", pending: "Waiting to send" };

/**
 * Where the journey is, in the traveller's own terms, and the one or two things they can say about it. Leaving, pausing and resting are
 * things the TRAVELLER says (the app never decides you have left because the clock passed the planned time, or that a day is over because
 * it is midnight). Each is saved with the time it was said, even with no signal. Below it, the journey so far, with how sure each line is.
 */
export function JourneyCard(p: Props) {
  const [busy, setBusy] = useState<JourneyKind | null>(null);
  const j = p.journey;
  const since = j.since ? `${timeText(j.since, p.offsetMin)}, ${dateText(Date.parse(j.since), p.offsetMin)}` : null;
  const status =
    p.closed ? "This trip is finished or called off."
    : j.state === "awaiting-departure" ? "You haven't set off yet."
    : j.state === "travelling" ? `On the road since ${since}.`
    : j.state === "paused" ? `Paused since ${since}.`
    : `Resting since ${since}.`;

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
    setFixBusy(false);
    setFixing(null);
  };
  const [step, setStep] = useState<"idle" | "form" | "noted" | "added">("idle");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const clean = name.trim();
  const saveUnplanned = async () => {
    if (!p.unplanned || !clean) return;
    setPending(true);
    await p.unplanned.add(clean);
    setPending(false);
    setStep("noted");
  };
  const addToPlan = async () => {
    if (!p.unplanned?.addToPlan) return;
    setPending(true);
    await p.unplanned.addToPlan(clean);
    setPending(false);
    setStep("added");
  };

  const go = async (kind: JourneyKind) => {
    setBusy(kind);
    await p.record(kind, kind === "departed" ? p.fix : { source: p.fix.source, accuracyM: p.fix.accuracyM });
    setBusy(null);
  };

  // Each day's first line gets the date above it.
  const dated = p.rows.map((r, i) => {
    const date = dateText(Date.parse(r.at), p.offsetMin);
    return { r, date, head: i === 0 || date !== dateText(Date.parse(p.rows[i - 1].at), p.offsetMin) };
  });
  return (
    <section aria-labelledby="journey-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5" data-testid="journey-card">
      <h2 id="journey-heading" className="font-display text-lg font-semibold text-pine">Your journey</h2>
      <p role="status" className="mt-1 text-sm text-ink-muted"><span className="font-semibold text-pine">{status}</span>
        {j.atPlace && <> {j.atPlace.name ? `Arrived at ${j.atPlace.name}` : "Arrived"} {timeText(j.atPlace.arrivedAt, p.offsetMin)}; not marked visited yet.</>}
      </p>

      {p.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.actions.map((k) => {
            const b = BUTTONS[k];
            if (!b) return null;
            return (
              <Button key={k} size="sm" variant={b.primary ? "primary" : "secondary"} onClick={() => void go(k)} loading={busy === k} loadingLabel="Saving…" disabled={busy !== null} className="min-h-11">
                <Glyph name={b.glyph} size={16} />{b.label}
              </Button>
            );
          })}
        </div>
      )}
      {p.unplanned && !p.closed && step === "idle" && (
        <div className="mt-3">
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setStep("form")}><Glyph name="pin" size={15} />I visited somewhere else</Button>
        </div>
      )}
      {p.unplanned && step === "form" && (
        <form className="mt-3 space-y-2 rounded-xl bg-sky px-3 py-3" onSubmit={(e) => { e.preventDefault(); void saveUnplanned(); }}>
          <TextField label="Where did you stop?" hint="A name is enough. It goes in your journey; your plan stays as it is." value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" loading={pending} loadingLabel="Saving…" disabled={!clean}>Add to my journey</Button>
            <Button size="sm" variant="secondary" onClick={() => { setStep("idle"); setName(""); }} disabled={pending}>Cancel</Button>
          </div>
        </form>
      )}
      {p.unplanned && step === "noted" && (
        <div role="status" className="mt-3 rounded-xl bg-teal-light px-3 py-3 text-sm text-teal-ink">
          <p className="font-semibold">Noted: {clean}.</p>
          {p.unplanned.addToPlan
            ? <><p className="mt-0.5 text-xs">Want it in your plan too? It would be added to {p.unplanned.dayLabel} as your next stop, at the place you are now. Nothing is marked done.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void addToPlan()} loading={pending} loadingLabel="Adding…">Add to {p.unplanned.dayLabel}</Button>
                <Button size="sm" variant="secondary" onClick={() => { setStep("idle"); setName(""); }} disabled={pending}>No, just note it</Button>
              </div></>
            : <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => { setStep("idle"); setName(""); }}>Done</Button></div>}
        </div>
      )}
      {p.unplanned && step === "added" && (
        <div role="status" className="mt-3 rounded-xl bg-teal-light px-3 py-3 text-sm text-teal-ink">
          <p className="font-semibold">{clean} is in your plan as your next stop.</p>
          <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => { setStep("idle"); setName(""); }}>Done</Button></div>
        </div>
      )}
      {p.actions.includes("departed") && <p className="mt-2 text-xs text-ink-muted">Saved with the time you tap. Only how accurate your location was is kept, never a trail of where you went.</p>}
      {p.waiting > 0 && <p role="status" className="mt-2 text-xs font-semibold text-[#7a4a00]">{p.waiting === 1 ? "1 update is" : `${p.waiting} updates are`} saved on this phone and will be sent when you&apos;re back online.</p>}
      {p.problem && p.correct && <p role="alert" className="mt-2 break-words text-xs font-semibold text-clay-ink">{p.problem}</p>}
      {p.stored === false && <p className="mt-2 text-xs text-ink-muted">Your journey can&apos;t be saved to the trip yet, so it only shows on this phone. Nothing is lost.</p>}
      {j.ignored.length > 0 && <p className="mt-2 text-xs text-ink-muted">{j.ignored.length === 1 ? "One update" : `${j.ignored.length} updates`} didn&apos;t fit the order of events and {j.ignored.length === 1 ? "was" : "were"} kept in the history without changing it.</p>}

      {p.rows.length > 0 && (
        <details className="mt-3 border-t border-line pt-3">
          <summary className="min-h-11 cursor-pointer select-none py-2 text-sm font-semibold text-pine">Journey so far ({p.rows.length})</summary>
          <ol className="mt-1 space-y-2">
            {dated.map(({ r, date, head }) => {
              return (
                <li key={r.key} className="min-w-0">
                  {head && <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink-muted">{date}</p>}
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="w-[4.5rem] shrink-0 text-sm font-semibold tabular-nums text-pine">{timeText(r.at, p.offsetMin)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`break-words text-sm ${r.certainty === "inferred" ? "italic text-ink-muted" : "text-pine"}`}>
                        {r.member && <span className="font-semibold">{r.member}: </span>}{r.label}
                      </p>
                      {r.detail && <p className="break-words text-xs text-ink-muted">{r.detail}</p>}
                      <p className="text-xs text-ink-muted">{CERTAINTY[r.certainty]}</p>
                      {r.note && <p className="break-words text-xs text-clay-ink">{r.note}</p>}
                      {p.correct && r.own && r.kind && !r.corrected && r.certainty !== "pending" && r.certainty !== "inferred" && (
                        fixing === r.key ? (
                          <div className="mt-1 space-y-2 rounded-xl bg-sky p-2">
                            <TextField label="What time was it really?" type="time" value={fixTime} onChange={(e) => setFixTime(e.target.value)} />
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
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
