"use client";

// The Phase 3 engine's parts of "Plan my trip": drive days, night halts, "what if I had N days?", fuel (litres first; rupees only after
// the traveller types today's price, which stays on this phone), and "How sure is this plan?" (every label the engine gives).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { fuelCost, litres } from "@/lib/engine/fuel";
import type { EngineView, NightHalt, TransitDay } from "@/lib/engine/types";
import { duration } from "@/lib/trip-builder";

export type EngineVariantView = EngineView["variants"][number];

export function TransitDayCard({ t, kind }: { t: TransitDay; kind: "out" | "back" }) {
  return (
    <article className="rounded-xl border border-dashed border-pine/30 bg-sky/40 p-3" aria-label={`Day ${t.day}: drive day`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-pine">Day {t.day}</h4>
        <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-pine"><Glyph name="car" size={13} />{kind === "out" ? "Drive day" : "Drive home"}</span>
      </header>
      <p className="mt-1 text-sm font-semibold text-pine">{t.from} → {t.to}</p>
      <p className="text-xs text-ink-muted">{duration(t.driveMin)} driving · {t.km.toLocaleString("en-IN")} km{t.daylightLimited ? " · stops early so you don't drive after dark" : ""}</p>
      {t.haltNote && <p className="mt-1.5 text-xs text-[#7a4a00]">{t.haltNote}</p>}
    </article>
  );
}

export function HaltLine({ h }: { h: NightHalt }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-sky px-3 py-1.5 text-xs text-ink-muted">
      <Glyph name="stay" size={13} className="mt-0.5 shrink-0 text-pine" />
      {h.noTown
        ? <span>Night halt: near <strong className="text-pine">{h.town}</strong> · no town in our map data nearby, so plan this night yourself</span>
        : <span>Night halt: <strong className="text-pine">{h.town}</strong>{h.area ? `, ${h.area}` : ""}{h.atStop ? "" : ` · about ${h.km} km, ${duration(h.driveMin)} (estimated)`}{h.checkStays ? " · a small town: check stays here" : ""}</span>}
    </p>
  );
}

/** "What if I had N days?" — answers come with the plan (no request), so moving the stepper is instant. */
export function WhatIfStepper({ v, numDays, canEdit, busy, onPlan }: { v: EngineVariantView; numDays: number; canEdit: boolean; busy: boolean; onPlan: (days: number) => void }) {
  const [n, setN] = useState(numDays);
  const rows = v.whatIf;
  if (!rows.length) return null;
  const min = rows[0].days, max = rows[rows.length - 1].days;
  const cur = rows.find((w) => w.days === n) ?? rows[rows.length - 1];
  const now = rows.find((w) => w.days === numDays);
  return (
    <section className="rounded-xl border border-line p-3.5" aria-labelledby="whatif-h">
      <h3 id="whatif-h" className="text-sm font-semibold text-pine">What if I had more (or fewer) days?</h3>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="grid h-11 w-11 place-items-center rounded-full border border-line text-lg font-bold text-pine disabled:opacity-40" disabled={n <= min} onClick={() => setN(n - 1)} aria-label="One day fewer">−</button>
        <p className="min-w-0 flex-1 text-center" aria-live="polite">
          <span className="block text-lg font-semibold text-pine">{n} {n === 1 ? "day" : "days"}</span>
          <span className="block text-sm text-ink-muted">{cur.places === 0 ? "Your places don't fit" : `${cur.places} of ${cur.of} places`} · {duration(cur.driveMin)} driving · {cur.km.toLocaleString("en-IN")} km</span>
        </p>
        <button type="button" className="grid h-11 w-11 place-items-center rounded-full border border-line text-lg font-bold text-pine disabled:opacity-40" disabled={n >= max} onClick={() => setN(n + 1)} aria-label="One day more">+</button>
      </div>
      {now && n !== numDays && <p className="mt-1.5 text-center text-xs text-ink-muted">With your {numDays} days: {now.places} of {now.of} places.</p>}
      {n !== numDays && (canEdit ? <div className="mt-2 flex justify-center"><Button size="sm" variant="secondary" disabled={busy} onClick={() => onPlan(n)}>Plan {n} {n === 1 ? "day" : "days"}</Button></div> : <p className="mt-2 text-center text-xs text-ink-muted">Only the trip owner can change the trip length.</p>)}
      <p className="mt-2 text-xs text-ink-muted">A quick estimate with the same rules; the full plan also checks opening hours and the exact order inside each day.</p>
    </section>
  );
}

const KEY_MILEAGE = "tm.fuel.kmpl", KEY_PRICE = "tm.fuel.price";
const read = (k: string): number | null => { try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
const write = (k: string, v: number | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* private mode: not kept */ } };

/** Fuel: litres from the km and the vehicle's mileage. Rupees only after the traveller enters today's price (kept on this phone). */
export function FuelCard({ km, defaultMileage }: { km: number; defaultMileage: number | null }) {
  const [mileage, setMileage] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => { setMileage(read(KEY_MILEAGE)); setPrice(read(KEY_PRICE)); }, 0); return () => clearTimeout(t); }, []);
  if (defaultMileage === null) return null;
  const kmpl = mileage ?? defaultMileage;
  const l = litres(km, kmpl);
  const rs = fuelCost(l, price);
  const num = (s: string) => { const v = Number(s); return s.trim() === "" || !Number.isFinite(v) || v <= 0 ? null : v; };
  return (
    <section className="rounded-xl border border-line p-3.5" aria-labelledby="fuel-h">
      <h3 id="fuel-h" className="flex items-center gap-1.5 text-sm font-semibold text-pine"><Glyph name="fuel" size={15} />Fuel</h3>
      <p className="mt-1 text-sm text-ink">About <strong>{l ?? "–"} litres</strong> for {km.toLocaleString("en-IN")} km{rs !== null ? <> · about <strong>₹{rs.toLocaleString("en-IN")}</strong></> : null}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-ink-muted">Your km per litre
          <input inputMode="decimal" className="mt-1 min-h-11 w-full rounded-xl border border-line px-2.5 text-sm text-ink" placeholder={String(defaultMileage)} defaultValue={mileage ?? ""} key={`m${mileage}`} onBlur={(e) => { const v = num(e.target.value); setMileage(v); write(KEY_MILEAGE, v); }} />
        </label>
        <label className="text-xs font-semibold text-ink-muted">Today&apos;s price, ₹ per litre
          <input inputMode="decimal" className="mt-1 min-h-11 w-full rounded-xl border border-line px-2.5 text-sm text-ink" placeholder="e.g. 105" defaultValue={price ?? ""} key={`p${price}`} onBlur={(e) => { const v = num(e.target.value); setPrice(v); write(KEY_PRICE, v); }} />
        </label>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">{mileage === null ? `Using ${defaultMileage} km per litre, a typical figure: change it to your vehicle's.` : "Using your vehicle's figure."} We don&apos;t know fuel prices; enter today&apos;s to see rupees. Both stay on this phone.</p>
    </section>
  );
}

/** Everything the plan rests on, said plainly: what is measured, what is estimated, what wasn't checked. */
export function PlanLabels({ e }: { e: EngineView }) {
  const L = e.labels;
  const lines = [L.travel, L.roadsText, L.margin, L.weather, L.hours, L.daylight, L.halts, L.tolls].filter(Boolean);
  return (
    <details className="rounded-xl border border-line" open={L.roads !== "routed" || e.permits.length > 0}>
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-3.5 text-sm font-semibold text-pine">
        <Glyph name="info" size={15} />How sure is this plan?
        {L.roads !== "routed" && <span className="ml-auto rounded-full bg-marigold-light px-2 py-0.5 text-[11px] font-bold text-[#7a4a00]">Roads {L.roads}</span>}
      </summary>
      <ul className="list-disc space-y-1 border-t border-line px-3.5 pb-3 pl-8 pt-2.5 text-xs text-ink-muted">
        {lines.map((t) => <li key={t}>{t}</li>)}
      </ul>
      {e.permits.length > 0 && (
        <div className="mx-3.5 mb-3 rounded-lg border border-marigold/50 bg-marigold-light/50 px-3 py-2">
          <p className="text-xs font-semibold text-pine">Permits</p>
          <ul className="mt-1 space-y-1 text-xs text-[#7a4a00]">{e.permits.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
    </details>
  );
}
