"use client";

// "Add an unplanned stop": find the place (or type its name), say what kind of stop it was, confirm. It is written to the journey's
// history only. It goes into the plan ONLY if the traveller ticks that, and then as the next stop with nothing marked done. A stop
// recorded wrongly is put right from "Your trip activity" (Correct this); nothing is ever deleted.
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { PickerSheet } from "@/components/ui/Sheet";
import { useDestinationSearch } from "@/lib/client/use-destination-search";
import type { PlaceChoice } from "@/lib/feed/compose";
import { STOP_TYPES, STOP_TYPE_INFO, type StopType } from "@/lib/trip/unplanned";

export type UnplannedPlace = { name: string; lat: number | null; lng: number | null };
type Props = {
  /** Where the traveller is (only used to rank search results), or null. */
  near: { lat: number; lng: number } | null;
  /** Saves it to the journey. */
  record: (p: { name: string; type: StopType }) => Promise<"saved" | "queued" | "failed">;
  /** Offered only when the chosen place has a position to put it at. Adds it to the plan as the next stop. */
  addToPlan: ((p: { name: string; lat: number; lng: number; type: StopType }) => Promise<unknown>) | null;
  dayLabel: string;
  onClose: () => void;
};

export function UnplannedStopSheet({ near, record, addToPlan, dayLabel, onClose }: Props) {
  const [q, setQ] = useState("");
  const [place, setPlace] = useState<(UnplannedPlace & { address?: string }) | null>(null);
  const [type, setType] = useState<StopType | null>(null);
  const [inPlan, setInPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { name: string; queued: boolean; planned: boolean }>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const s = useDestinationSearch(q, near);
  const typed = q.trim();
  const shown = s.results.slice(0, 6);
  const chosen = place ?? (typed.length >= 2 ? { name: typed, lat: null, lng: null } : null);
  const canPlan = !!addToPlan && !!chosen && chosen.lat !== null && chosen.lng !== null;

  const pick = (p: PlaceChoice) => { setPlace({ name: p.name, lat: p.lat, lng: p.lng, address: p.address }); setQ(p.name); };
  const save = async () => {
    if (!chosen || !type) return;
    setBusy(true); setProblem(null);
    const r = await record({ name: chosen.name, type });
    if (r === "failed") { setBusy(false); setProblem("That couldn't be saved. Check your connection and try again."); return; }
    let planned = false;
    if (inPlan && canPlan && addToPlan) { await addToPlan({ name: chosen.name, lat: chosen.lat as number, lng: chosen.lng as number, type }); planned = true; }
    setBusy(false);
    setDone({ name: chosen.name, queued: r === "queued", planned });
  };

  if (done) {
    return (
      <PickerSheet title="Stop added" onClose={onClose} footer={<Button className="min-h-12 w-full" onClick={onClose}>Back to my trip</Button>}>
        <div role="status" className="space-y-2 px-4 py-5 text-sm">
          <p className="flex items-center gap-2 text-base font-semibold text-pine"><Glyph name="checkCircle" size={22} className="text-teal" />{done.name}</p>
          <p className="text-ink-muted">Added to your trip activity{done.queued ? " (it will be sent when you're back online)" : ""}. {done.planned ? `It is also in your plan as the next stop on ${dayLabel}; nothing was marked done.` : "Your plan is unchanged."}</p>
          <p className="text-xs text-ink-muted">Got it wrong? Open Your trip activity and tap Correct this.</p>
        </div>
      </PickerSheet>
    );
  }

  return (
    <PickerSheet title="Add an unplanned stop" onClose={onClose} footer={
      <div className="space-y-2">
        {problem && <p role="alert" className="text-xs font-semibold text-clay-ink">{problem}</p>}
        <Button className="min-h-12 w-full text-base" disabled={!chosen || !type} onClick={() => void save()} loading={busy} loadingLabel="Saving…">{chosen && type ? `Add ${chosen.name.length > 28 ? "this stop" : chosen.name}` : "Choose a place and a type"}</Button>
      </div>
    }>
      <div className="space-y-5 px-4 py-4 text-sm">
        <p className="text-ink-muted">Use this for a stop that wasn&apos;t in your plan: a temple you saw, a meal, fuel, a night somewhere else. It&apos;s saved with the time you add it.</p>
        <div>
          <label htmlFor="unplanned-q" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Where did you stop?</label>
          <input id="unplanned-q" data-autofocus="true" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPlace(null); }} maxLength={120} autoComplete="off" enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === "Enter" && typed.length >= 2) { e.preventDefault(); s.searchMap(); } }}
            placeholder="A place name, e.g. Kanaka Durga Temple" className="mt-1 min-h-12 w-full rounded-xl border-2 border-line bg-white px-3 text-base focus:border-teal" />
          {!place && (
            <div aria-live="polite" className="mt-2 space-y-1.5">
              {typed.length >= 2 && <button type="button" onClick={s.searchMap} disabled={s.mapLoading} className="min-h-11 rounded-full border border-teal bg-teal-light px-4 text-sm font-semibold text-teal-ink disabled:opacity-60">{s.mapLoading ? "Searching…" : s.mapSearched ? "Search again" : "Search the map"}</button>}
              {s.mapError && <p role="alert" className="text-xs font-semibold text-clay-ink">{s.mapError} You can still use the name you typed.</p>}
              {shown.length > 0 && (
                <ul className="space-y-1.5">
                  {shown.map((p) => (
                    <li key={`${p.name}|${p.lat.toFixed(3)},${p.lng.toFixed(3)}`}>
                      <button type="button" onClick={() => pick(p)} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left hover:border-teal">
                        <Glyph name="pin" size={16} className="shrink-0 text-teal" />
                        <span className="min-w-0"><span className="block break-words font-semibold text-pine">{p.name}</span>{p.address && <span className="block truncate text-xs text-ink-muted">{p.address}</span>}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {typed.length >= 2 && <p className="text-xs text-ink-muted">Not listed? Just continue: the name you typed is enough.</p>}
            </div>
          )}
          {place && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-teal-ink"><Glyph name="check" size={14} />Place found on the map</p>}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">What kind of stop?</p>
          <div role="group" aria-label="Kind of stop" className="mt-2 grid grid-cols-2 gap-2">
            {STOP_TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={`flex min-h-14 items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left transition active:scale-[0.98] ${type === t ? "border-pine bg-pine text-white" : "border-line bg-white text-pine hover:border-teal"}`}>
                <Glyph name={STOP_TYPE_INFO[t].glyph} size={20} className="shrink-0" />
                <span className="min-w-0"><span className="block text-sm font-semibold leading-tight">{STOP_TYPE_INFO[t].label}</span><span className={`block text-[11px] leading-tight ${type === t ? "text-white/80" : "text-ink-muted"}`}>{STOP_TYPE_INFO[t].hint}</span></span>
              </button>
            ))}
          </div>
        </div>

        {canPlan && (
          <label className="flex min-h-11 items-start gap-2.5 rounded-xl bg-sky px-3 py-2.5 text-pine">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--teal)]" checked={inPlan} onChange={(e) => setInPlan(e.target.checked)} />
            <span>Also add it to my plan <span className="block text-xs text-ink-muted">As the next stop on {dayLabel}. Nothing is marked done and no other stop moves.</span></span>
          </label>
        )}
      </div>
    </PickerSheet>
  );
}
