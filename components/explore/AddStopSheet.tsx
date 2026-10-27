"use client";

// "Add as a stop": BEFORE anything changes, show what it does to that day — where it fits best, how much longer the day gets, which
// later stops move and to when, and what we could (and couldn't) check. Only a tap on "Add to Day N" changes the trip, and that can be
// undone straight away.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { PickerSheet } from "@/components/ui/Sheet";
import { Select } from "@/components/ui/Select";
import { formatDuration } from "@/lib/format";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import type { EffectAnswer } from "@/lib/server/explore-effect";

type Place = { id: string; name: string; lat: number; lng: number; category: ExploreCategoryId };
type Props = { tripId: string; place: Place; onClose: () => void; onSaveIdea: () => void };
type Phase = { kind: "loading" } | { kind: "ready"; a: EffectAnswer } | { kind: "error"; message: string } | { kind: "saving"; a: EffectAnswer } | { kind: "done"; a: EffectAnswer; newId: string | null } | { kind: "undone" };

const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  return { ok: !!r?.ok, status: r?.status ?? 0, body: j as Record<string, unknown> | null };
};

export function AddStopSheet({ tripId, place, onClose, onSaveIdea }: Props) {
  const [day, setDay] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void post("/api/explore/trip/effect", { trip_id: tripId, day_number: day, place: { name: place.name, lat: place.lat, lng: place.lng, category: place.category } }).then((r) => {
      if (!live) return;
      if (r.ok && r.body) setPhase({ kind: "ready", a: r.body as unknown as EffectAnswer });
      else setPhase({ kind: "error", message: r.status === 0 ? "You seem to be offline. Nothing was changed." : (typeof r.body?.error === "string" ? r.body.error : "We couldn't work that out right now.") });
    });
    return () => { live = false; };
  }, [tripId, place, day, attempt]);

  const a = phase.kind === "ready" || phase.kind === "saving" || phase.kind === "done" ? phase.a : null;
  const e = a?.effect;

  async function add() {
    if (!a) return;
    setPhase({ kind: "saving", a });
    const r = await post(`/api/trips/${tripId}/insert-stop`, { name: place.name, lat: place.lat, lng: place.lng, day_number: a.day, category: place.category, before_id: a.effect.beforeId, notes: "Added from Explore" });
    if (r.ok) setPhase({ kind: "done", a, newId: typeof r.body?.id === "string" ? r.body.id : null });
    else if (r.status === 409) { setPhase({ kind: "loading" }); setAttempt((n) => n + 1); }   // the day changed: look again, never guess
    else setPhase({ kind: "error", message: typeof r.body?.error === "string" ? r.body.error : "Couldn't add it. Nothing was changed." });
  }
  async function undo() {
    if (phase.kind !== "done" || !phase.newId) return;
    const r = await fetch(`/api/places/${phase.newId}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setPhase({ kind: "undone" }); else setPhase({ kind: "error", message: "Couldn't undo. Remove it from the plan instead." });
  }

  const where = e ? (e.beforeName && e.afterName ? `Between ${e.afterName} and ${e.beforeName}` : e.beforeName ? `First, before ${e.beforeName}` : e.afterName ? `At the end of the day, after ${e.afterName}` : "The first stop of the day") : "";

  return (
    <PickerSheet title={`Add ${place.name} as a stop`} onClose={onClose}>
      <div className="space-y-4 p-4 text-sm" aria-live="polite">
        {a && phase.kind !== "done" && (
          <div>
            <label htmlFor="add-stop-day" className="text-sm font-semibold text-pine">Which day</label>
            <div className="mt-1"><Select id="add-stop-day" label="Which day" value={String(a.day)} onChange={(v) => { setPhase({ kind: "loading" }); setDay(Number(v)); }}
              options={Array.from({ length: a.days }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` }))} /></div>
          </div>
        )}
        {phase.kind === "loading" && <p className="text-ink-muted">Working out what it changes…</p>}
        {phase.kind === "error" && (
          <div role="alert" className="rounded-xl border border-clay/40 bg-clay-light/50 p-3">
            <p className="font-semibold text-clay-ink">{phase.message}</p>
            <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => { setPhase({ kind: "loading" }); setAttempt((n) => n + 1); }}>Try again</Button></div>
          </div>
        )}
        {e && phase.kind !== "done" && (
          <>
            <div className="rounded-xl border border-line bg-sky/40 p-3">
              <p className="font-semibold text-pine">{where}</p>
              <p className="mt-1 text-ink">Adds about <strong>{formatDuration(e.addedMin)}</strong> to Day {a!.day}: {formatDuration(e.addedDriveMin)} more driving{e.basis === "estimate" ? " (estimated)" : ""} and about {formatDuration(e.visitMin)} there.</p>
            </div>
            {e.shifted.length > 0 && (
              <div>
                <p className="font-semibold text-pine">Later stops move</p>
                <ul className="mt-1 space-y-1">{e.shifted.map((s) => <li key={s.id} className="flex justify-between gap-3"><span className="min-w-0 break-words">{s.name}</span><span className="shrink-0 font-mono text-xs">{s.from} → about {s.to}</span></li>)}</ul>
              </div>
            )}
            {e.warnings.length > 0 && <ul className="space-y-1.5">{e.warnings.map((w) => <li key={w} className="flex items-start gap-2 rounded-xl bg-clay-light px-3 py-2 text-clay-ink"><Glyph name="warn" size={15} className="mt-0.5" /><span>{w}</span></li>)}</ul>}
            {e.unknowns.length > 0 && <ul className="space-y-1">{e.unknowns.map((u) => <li key={u} className="text-xs text-ink-muted">{u}</li>)}</ul>}
            <p className="text-xs text-ink-muted">Nothing changes until you tap Add. Times after it are cleared until you re-plan that day.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void add()} loading={phase.kind === "saving"} loadingLabel="Adding…">Add to Day {a!.day}</Button>
              <Button variant="ghost" onClick={() => { onSaveIdea(); onClose(); }}>Just save to my ideas</Button>
            </div>
          </>
        )}
        {phase.kind === "done" && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-semibold text-teal-ink"><Glyph name="check" size={18} />Added to Day {phase.a.day}.</p>
            <p className="text-ink-muted">That day&apos;s later times need a re-plan, so they show as not set until you do.</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/trips/${tripId}/plan`} className="inline-flex min-h-11 items-center rounded-xl bg-marigold px-4 font-bold text-pine">Open the plan</Link>
              {phase.newId && <Button variant="secondary" onClick={() => void undo()}>Undo</Button>}
            </div>
          </div>
        )}
        {phase.kind === "undone" && <p className="font-semibold text-pine">Undone. The plan is as it was (re-plan the day if its times were cleared).</p>}
      </div>
    </PickerSheet>
  );
}
