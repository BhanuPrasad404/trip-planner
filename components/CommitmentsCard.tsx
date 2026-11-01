"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import type { Commitment, NewCommitment } from "@/lib/client/use-commitments";

const KIND: Record<Commitment["kind"], string> = { hotel: "Hotel", ticket: "Ticket", event: "Event", reservation: "Reservation", transport: "Transport", activity: "Activity" };
const pad = (n: number) => String(n).padStart(2, "0");
const nice = (m: number) => { const h = Math.floor(m / 60); return `${h % 12 === 0 ? 12 : h % 12}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`; };
const toMin = (t: string): number | null => { const m = /^(\d{2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

type Props = {
  list: Commitment[];
  stored: boolean | null;
  error: string | null;
  busy: boolean;
  /** The stops of the trip a booking can belong to. */
  stops: { id: string; name: string; day: number | null }[];
  numDays: number;
  userId: string;
  isOwner: boolean;
  onAdd: (c: NewCommitment) => Promise<boolean>;
  onConfirmed: (id: string, confirmed: boolean) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  /** Start with the form open (used to look at the screen). */
  initiallyAdding?: boolean;
};

/**
 * The traveller's bookings and time-bound activities. A saved place is not a booking: this is where someone says "this is booked", and
 * whether it is confirmed with the provider. Confirmed ones are protected when the plan is rearranged; the others only warn. Anything here is
 * the traveller's own statement, and the card says so.
 */
export function CommitmentsCard(p: Props) {
  const [adding, setAdding] = useState(p.initiallyAdding ?? false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Commitment["kind"]>("hotel");
  const [cls, setCls] = useState<Commitment["constraint_class"]>("fixed");
  const [day, setDay] = useState(1);
  const [placeId, setPlaceId] = useState("");
  const [from, setFrom] = useState("");
  const [by, setBy] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reference, setReference] = useState("");
  const days = Array.from({ length: Math.max(1, p.numDays) }, (_, i) => i + 1);
  const reset = () => { setAdding(false); setLabel(""); setFrom(""); setBy(""); setConfirmed(false); setReference(""); setPlaceId(""); };

  const submit = async () => {
    if (!label.trim()) return;
    const ok = await p.onAdd({
      label: label.trim(), kind, constraint_class: cls, day, place_id: placeId || null, confirmed,
      earliest_min: cls === "time_sensitive" ? toMin(from) : null, latest_min: cls === "time_sensitive" ? toMin(by) : null, reference: confirmed && reference.trim() ? reference.trim() : null,
    });
    if (ok) reset();
  };

  return (
    <section aria-labelledby="commitments-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5" data-testid="commitments-card">
      <details open={p.list.length > 0 || adding}>
        <summary className="min-h-11 cursor-pointer select-none py-2"><h2 id="commitments-heading" className="inline font-display text-lg font-semibold text-pine">My bookings ({p.list.length})</h2></summary>
        <p className="text-sm text-ink-muted">A place you saved isn&apos;t a booking. Tell us what you&apos;ve actually booked and we&apos;ll protect it when you rearrange your trip. Confirmed bookings are never moved; the others only get a warning.</p>
        {p.stored === false && <p className="mt-2 text-xs text-ink-muted">Bookings can&apos;t be saved to the trip yet. Nothing is lost.</p>}
        {p.error && <p role="alert" className="mt-2 rounded-xl bg-clay-light px-3 py-2 text-sm font-medium text-clay-ink">{p.error}</p>}

        {p.list.length > 0 && (
          <ul className="mt-3 space-y-2">
            {p.list.map((c) => {
              const stop = p.stops.find((s) => s.id === c.place_id);
              const mine = c.created_by === p.userId || p.isOwner;
              return (
                <li key={c.id} className="min-w-0 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-words text-base font-semibold text-pine">{c.label}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.source === "confirmed" ? "bg-teal-light text-teal-ink" : "bg-sky text-pine"}`}>{c.source === "confirmed" ? "Confirmed" : c.source === "imported" ? "From a document, not confirmed" : "Your word"}</span>
                  </div>
                  <p className="mt-0.5 break-words text-sm text-ink-muted">
                    {KIND[c.kind]} · Day {c.day}{stop ? ` · ${stop.name}` : ""} · {c.constraint_class === "fixed" ? "the day can't move" : `arrive${c.earliest_min !== null ? ` from ${nice(c.earliest_min)}` : ""}${c.latest_min !== null ? ` by ${nice(c.latest_min)}` : ""}`}
                    {c.reference ? ` · ref ${c.reference}` : ""}
                  </p>
                  {mine && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" className="min-h-11" disabled={p.busy} onClick={() => void p.onConfirmed(c.id, c.source !== "confirmed")}>{c.source === "confirmed" ? "It's not confirmed" : "It's confirmed"}</Button>
                      <Button size="sm" variant="ghost" className="min-h-11" disabled={p.busy} onClick={() => void p.onRemove(c.id)}>Remove</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!adding && <div className="mt-3"><Button size="sm" variant="secondary" className="min-h-11" onClick={() => setAdding(true)}>Add a booking</Button></div>}
        {adding && (
          <form className="mt-3 space-y-3 rounded-xl bg-sky px-3 py-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <TextField label="What is it?" hint="For example: Hotel Sai Residency, night 3" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-semibold text-pine">Kind
                <select className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as Commitment["kind"])}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="block text-sm font-semibold text-pine">Day
                <select className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-2 text-sm" value={day} onChange={(e) => setDay(Number(e.target.value))}>{days.map((d) => <option key={d} value={d}>Day {d}</option>)}</select>
              </label>
            </div>
            <label className="block text-sm font-semibold text-pine">Which stop is it?
              <select className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-2 text-sm" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
                <option value="">None in particular</option>
                {p.stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <fieldset className="space-y-1">
              <legend className="text-sm font-semibold text-pine">How firm is it?</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm text-pine"><input type="radio" name="cls" className="h-5 w-5 accent-[var(--teal)]" checked={cls === "fixed"} onChange={() => setCls("fixed")} />The day can&apos;t move</label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-pine"><input type="radio" name="cls" className="h-5 w-5 accent-[var(--teal)]" checked={cls === "time_sensitive"} onChange={() => setCls("time_sensitive")} />That day, and I must arrive in a time window</label>
            </fieldset>
            {cls === "time_sensitive" && (
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Arrive from (optional)" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                <TextField label="Arrive by (optional)" type="time" value={by} onChange={(e) => setBy(e.target.value)} />
              </div>
            )}
            <label className="flex min-h-11 items-start gap-2 text-sm text-pine"><input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--teal)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>This is confirmed with the hotel, venue or provider. Confirmed bookings are never moved.</span></label>
            {confirmed && <TextField label="Booking reference (optional)" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="submit" loading={p.busy} loadingLabel="Saving…" disabled={!label.trim()} className="min-h-11">Save booking</Button>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={reset} disabled={p.busy}>Cancel</Button>
            </div>
          </form>
        )}
      </details>
    </section>
  );
}
