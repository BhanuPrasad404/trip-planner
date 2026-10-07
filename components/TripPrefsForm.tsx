"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TRIP_TYPES, TRIP_TYPE_LABEL, type TripType } from "@/lib/intel/types";
import { Button } from "./ui/Button";

const BLURB: Record<TripType, string> = {
  friends: "Sights and viewpoints rank a little higher.",
  family: "Restrooms, food, pharmacies and hospitals rank higher.",
  couple: "Viewpoints and cafes rank higher.",
  solo: "Stays, ATMs and cafes rank a little higher.",
  biker: "Fuel, repair shops, cafes and viewpoints rank higher.",
  backpacker: "ATMs, food and sights rank a little higher.",
};

/** Who is travelling and how far the vehicle goes. Tunes Travel Radar and Smart Stops. Only the owner can save. */
export function TripPrefsForm({ tripId, tripType, rangeKm, isOwner }: { tripId: string; tripType: TripType; rangeKm: number; isOwner: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<TripType>(tripType);
  const [range, setRange] = useState(String(rangeKm));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const n = Number(range);
    if (!Number.isInteger(n) || n < 80 || n > 1500) return setMsg({ ok: false, text: "Range must be a whole number between 80 and 1500 km." });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/preferences`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trip_type: type, vehicle_range_km: n }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't save.");
      setMsg({ ok: true, text: "Saved. Suggestions now use this." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="prefs-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="prefs-heading" className="font-display text-lg font-semibold text-pine">How you travel</h2>
      <p className="mt-1 text-sm text-ink-muted">This tunes what Travel Radar and Smart Stops recommend. {BLURB[type]}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-pine">Who is travelling?
          <select value={type} onChange={(e) => setType(e.target.value as TripType)} disabled={!isOwner} className="mt-1 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base font-normal disabled:bg-sky">
            {TRIP_TYPES.map((t) => <option key={t} value={t}>{TRIP_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-pine">Range on a full tank (km)
          <input type="number" inputMode="numeric" min={80} max={1500} value={range} onChange={(e) => setRange(e.target.value)} disabled={!isOwner} className="mt-1 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base font-normal disabled:bg-sky" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={!isOwner || busy}>{busy ? "Saving…" : "Save"}</Button>
        {!isOwner && <p className="text-sm text-ink-muted">Only the trip owner can change this.</p>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold ${msg.ok ? "text-teal-ink" : "text-clay-ink"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
