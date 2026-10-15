"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { useAction } from "@/lib/client/use-action";
import { useLocalJson } from "@/lib/client/use-local-json";
import { clockLabel, dayEndFrom, type Lifecycle } from "@/lib/trip/lifecycle";

const EMPTY = {} as Record<string, never>;
const HOURS = [1, 2, 3, 4, 6, 8, 10, 12] as const;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMinutes = (hhmm: string): number | null => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; };

type Props = { tripId: string; lifecycle: Lifecycle; isOwner: boolean; /** e.g. "12 Oct – 13 Oct", or null when the trip has no dates. */ plannedLabel: string | null };

/**
 * What to do with a trip whose real life and planned dates have come apart, in the traveller's terms. It only ever records the
 * traveller's decision (resume, finish, cancel, reopen). It never changes the planned dates, never marks a stop visited, never touches
 * memories, and never starts navigation: resuming takes you to the Live page, where Start drive is still your tap.
 */
export function TripLifecycleCard({ tripId, lifecycle, isOwner, plannedLabel }: Props) {
  const router = useRouter();
  const [keep, setKeep] = useLocalJson<{ keep?: boolean }>(`tm:lifecycle-keep:${tripId}`, EMPTY);
  const [step, setStep] = useState<"idle" | "resume" | "finish" | "cancel">("idle");
  const [leave, setLeave] = useState<"now" | "later">("now");
  const [laterAt, setLaterAt] = useState("17:00");
  const [hours, setHours] = useState<number>(4);

  const send = useAction(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/trips/${tripId}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(data?.error ?? "We couldn't do that. Nothing was changed. Please try again.");
  }, { fallbackError: "We couldn't do that. Nothing was changed. Please try again." });

  if (lifecycle.kind === "normal") return null;
  const only = !isOwner ? <p className="mt-2 text-xs text-ink-muted">Only the trip owner can change this.</p> : null;
  const shell = (children: React.ReactNode, tone: "info" | "quiet" = "info") => (
    <section role="region" aria-label="Trip status" className={`mt-3 rounded-2xl border p-3.5 text-sm ${tone === "info" ? "border-marigold/40 bg-marigold-light/50" : "border-line bg-white"}`}>{children}</section>
  );

  const departMin = leave === "now" ? nowMinutes() : toMinutes(laterAt);
  const dayEnd = departMin === null ? null : dayEndFrom(departMin, hours);
  const resume = async () => {
    if (dayEnd === null) return;
    const r = await send.run({ action: "resume", day_end_min: dayEnd });
    if (r.ok) { router.push(`/trips/${tripId}/live`); router.refresh(); }
  };
  const simple = async (action: "finish" | "cancel" | "reopen") => { const r = await send.run({ action }); if (r.ok) { setStep("idle"); router.refresh(); } };

  const resumeForm = (title: string) => (
    <div className="mt-3 rounded-xl border border-line bg-white p-3">
      <h3 className="font-semibold text-pine">{title}</h3>
      <fieldset className="mt-2">
        <legend className="text-xs font-semibold text-ink-muted">When are you leaving?</legend>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="leave" checked={leave === "now"} onChange={() => setLeave("now")} />Right now</label>
          <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="leave" checked={leave === "later"} onChange={() => setLeave("later")} />Later today at <input type="time" aria-label="Departure time" value={laterAt} onChange={(e) => { setLaterAt(e.target.value); setLeave("later"); }} className="min-h-11 rounded-lg border border-line px-2" /></label>
        </div>
      </fieldset>
      <label className="mt-2 block text-xs font-semibold text-ink-muted">How long can you travel?
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="ml-2 min-h-11 rounded-lg border border-line bg-white px-2 text-sm font-normal text-ink">
          {HOURS.map((h) => <option key={h} value={h}>about {h} hour{h === 1 ? "" : "s"}</option>)}
        </select>
      </label>
      <p className="mt-2 text-xs text-ink-muted">
        {dayEnd === null ? "Choose a valid departure time." : <>We&apos;ll plan to wrap up by <strong className="text-pine">{clockLabel(dayEnd)}</strong>. </>}
        Your planned dates stay as they are. Nothing starts by itself: on the Live page you press Start drive, and we plan from where you are then (or from the place you choose if GPS isn&apos;t available), checking opening hours and conditions. Any change to your stops is suggested first, and you decide.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={() => void resume()} loading={send.pending} loadingLabel="Resuming…" disabled={dayEnd === null}>Resume trip</Button>
        <Button variant="secondary" className="min-h-11" onClick={() => { setStep("idle"); send.clearError(); }}>Not now</Button>
      </div>
    </div>
  );
  const confirm = (kind: "finish" | "cancel") => (
    <div className="mt-3 rounded-xl border border-line bg-white p-3">
      <p className="font-semibold text-pine">{kind === "finish" ? "Finish this trip?" : "Call off this trip?"}</p>
      <p className="mt-1 text-xs text-ink-muted">Your stops, what you marked done and skipped, and your memories are all kept. {kind === "finish" ? "The trip will show as Finished." : "The trip will show as Cancelled."} You can reopen it later.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={() => void simple(kind)} loading={send.pending} loadingLabel="Saving…">{kind === "finish" ? "Yes, finish it" : "Yes, call it off"}</Button>
        <Button variant="secondary" className="min-h-11" onClick={() => setStep("idle")}>Keep it</Button>
      </div>
    </div>
  );
  const error = <div className="mt-2"><FormError message={send.error} /></div>;
  const link = "inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 text-sm font-semibold text-pine";

  if (lifecycle.kind === "closed") {
    const cancelled = lifecycle.reason === "cancelled";
    return shell(
      <>
        <p className="font-semibold text-pine">{cancelled ? "This trip was called off" : "This trip is finished"} · {when(lifecycle.at)}</p>
        <p className="mt-0.5 text-ink-muted">Its stops, progress and memories are kept. Opening Live or Map shows them; nothing restarts by itself.</p>
        {isOwner ? <div className="mt-2"><Button size="sm" variant="secondary" className="min-h-11" onClick={() => void simple("reopen")} loading={send.pending} loadingLabel="Reopening…">Reopen this trip</Button></div> : only}
        {error}
      </>, "quiet");
  }

  if (lifecycle.kind === "resumed") {
    return shell(
      <>
        <p className="font-semibold text-pine">Resumed {when(lifecycle.since)} · {lifecycle.remaining === 0 ? "every stop is done or skipped" : `${lifecycle.remaining} stop${lifecycle.remaining === 1 ? "" : "s"} to go`}</p>
        <p className="mt-0.5 text-ink-muted">Planned dates{plannedLabel ? ` (${plannedLabel})` : ""} are unchanged.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={`/trips/${tripId}/live`} className={link}>Open Live trip</Link>
          {isOwner && step === "idle" && <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setStep("finish")}>Finish trip</Button>}
        </div>
        {!isOwner && only}
        {step === "finish" && confirm("finish")}
        {error}
      </>, "quiet");
  }

  if (lifecycle.kind === "expired-never-started") {
    if (keep.keep && step === "idle") {
      return shell(
        <p className="flex flex-wrap items-center gap-x-3">
          <span className="text-ink-muted">Dates passed · saved plan kept as it is.</span>
          {isOwner && <button type="button" onClick={() => { setKeep({ keep: false }); setStep("resume"); }} className="min-h-11 font-semibold text-teal-ink underline underline-offset-2">Resume</button>}
          <button type="button" onClick={() => setKeep({ keep: false })} className="min-h-11 font-semibold text-pine underline underline-offset-2">Show options</button>
        </p>, "quiet");
    }
    return shell(
      <>
        <p className="font-semibold text-pine">The planned dates{plannedLabel ? ` (${plannedLabel})` : ""} have passed</p>
        <p className="mt-0.5 text-ink-muted">This trip was never started: no stop was marked done, so it isn&apos;t marked as completed. What would you like to do?</p>
        {isOwner ? (
          <>
            {step === "idle" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button className="min-h-11" onClick={() => setStep("resume")}>Resume now</Button>
                <Link href={`/trips/${tripId}#dates-heading`} className={link}>Reschedule</Link>
                <Button variant="secondary" className="min-h-11" onClick={() => setKeep({ keep: true })}>Keep saved plan</Button>
                <Button variant="ghost" className="min-h-11" onClick={() => setStep("cancel")}>Call it off</Button>
              </div>
            )}
            {step === "resume" && resumeForm("Resume this trip now")}
            {step === "cancel" && confirm("cancel")}
          </>
        ) : only}
        {error}
      </>);
  }

  // expired-started
  const l = lifecycle;
  return shell(
    <>
      <p className="font-semibold text-pine">The planned dates{plannedLabel ? ` (${plannedLabel})` : ""} have passed, but this trip is under way</p>
      <p className="mt-0.5 text-ink-muted">{l.done} of {l.stops} stop{l.stops === 1 ? "" : "s"} done{l.skipped ? `, ${l.skipped} skipped` : ""}; your progress is kept. {l.remaining > 0 ? `${l.remaining} stop${l.remaining === 1 ? "" : "s"} left.` : "Nothing is left to do."}</p>
      {isOwner ? (
        <>
          {step === "idle" && (
            <div className="mt-2 flex flex-wrap gap-2">
              {l.remaining > 0 && <Button className="min-h-11" onClick={() => setStep("resume")}>Continue from the next stop</Button>}
              {l.remaining > 0 && <Link href={`/trips/${tripId}/plan`} className={link}>Revise the rest</Link>}
              <Button variant={l.remaining > 0 ? "secondary" : "primary"} className="min-h-11" onClick={() => setStep("finish")}>Finish trip</Button>
            </div>
          )}
          {step === "resume" && resumeForm("Continue from your next stop")}
          {step === "finish" && confirm("finish")}
        </>
      ) : only}
      {error}
    </>);
}
