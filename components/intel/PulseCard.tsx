"use client";

import { useState } from "react";
import type { Pulse, PulseSignal, PulseSource } from "@/lib/intel/pulse";
import { Glyph } from "@/components/ui/Glyph";

type Props = { name: string; lat: number; lng: number; hours?: string | null; hoursCheckedAt?: string | null; /** True only for trip stops — never for Radar places. */ showTravelerPhotos?: boolean };

// How to read each source — shown on every signal so nothing looks more certain than it is.
const SOURCE: Record<PulseSource, { label: string; cls: string; hint: string }> = {
  recent: { label: "Recent", cls: "bg-teal-light text-teal-ink", hint: "Reported by a traveler in the last 6 hours" },
  forecast: { label: "Forecast", cls: "bg-sky text-pine", hint: "From the weather forecast" },
  "map-data": { label: "Map data", cls: "bg-marigold-light text-[#7a4a00]", hint: "From OpenStreetMap — not an official listing" },
  community: { label: "Community", cls: "bg-sky text-ink-muted", hint: "Traveler reports from the last 7 days" },
  historical: { label: "Historical", cls: "bg-line text-ink-muted", hint: "A past pattern, not live information" },
};
const TRUST_DOTS = { high: 3, medium: 2, low: 1 } as const;

function Signal({ s }: { s: PulseSignal }) {
  const src = SOURCE[s.source];
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span title={src.hint} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${src.cls}`}>{src.label}</span>
        <span className="font-semibold text-pine">{s.title}</span>
        <span title={`Confidence: ${s.trust}`} aria-label={`Confidence ${s.trust}`} className="ml-auto inline-flex gap-0.5 text-ink-muted">{[1, 2, 3].map((n) => <span key={n} aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${n <= TRUST_DOTS[s.trust] ? "bg-teal" : "bg-line"}`} />)}</span>
      </div>
      <p className="mt-0.5">{s.value}</p>
      {s.ageText && <p className="text-xs text-ink-muted">{s.ageText}</p>}
      {s.detail && <p className="text-xs text-ink-muted">{s.detail}</p>}
    </li>
  );
}

/** Opens on demand — so a page full of places never loads a pulse for every one of them. */
export function PulseCard({ name, lat, lng, hours = null, hoursCheckedAt = null, showTravelerPhotos = false }: Props) {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pulse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, name, hours, hours_checked_at: hoursCheckedAt, utc_offset_min: -new Date().getTimezoneOffset(), include_photos: showTravelerPhotos }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load live information.");
      setPulse(body.pulse as Pulse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load live information.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { const next = !open; setOpen(next); if (next && !pulse && !busy) void load(); }}
        className="min-h-9 text-sm font-semibold text-teal-ink underline underline-offset-2"
      >
        {open ? "Hide live pulse" : "Live pulse"}<span className="sr-only"> for {name}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-white p-3" aria-live="polite">
          {busy && <p className="text-sm text-ink-muted">Checking what&apos;s known right now…</p>}
          {error && <p role="alert" className="text-sm font-semibold text-clay-ink">{error} <button type="button" onClick={load} className="underline">Try again</button></p>}
          {pulse && (
            <>
              {pulse.conflicts.map((c) => (
                <p key={c.id} role="alert" className="mb-2 rounded-lg border border-clay/40 bg-clay-light/70 px-3 py-2 text-sm text-clay-ink">
                  <Glyph name="warn" size={15} className="mr-1.5 inline align-text-bottom text-marigold" /><strong>{c.title}</strong><br />{c.detail}
                </p>
              ))}
              {pulse.signals.length > 0 ? <ul className="divide-y divide-line">{pulse.signals.map((s) => <Signal key={s.id} s={s} />)}</ul> : <p className="text-sm text-ink-muted">No live signals for this place right now.</p>}
              {pulse.photos.length > 0 && (
                <ul className="mt-2 flex gap-2 overflow-x-auto" aria-label="Recent traveler photos">
                  {pulse.photos.map((p) => (
                    <li key={p.url} className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- real traveler photo, already downscaled */}
                      <img src={p.url} alt={`Traveler photo of ${name}, ${p.ageText}`} width={96} height={96} loading="lazy" className="h-24 w-24 rounded-lg object-cover" />
                      <span className="block text-center text-[11px] text-ink-muted">{p.ageText}</span>
                    </li>
                  ))}
                </ul>
              )}
              {pulse.gaps.length > 0 && (
                <details className="mt-2 text-xs text-ink-muted">
                  <summary className="cursor-pointer font-semibold">Not available ({pulse.gaps.length})</summary>
                  <ul className="mt-1 list-disc pl-5">{pulse.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
                </details>
              )}
              <p className="mt-2 text-[11px] text-ink-muted">Dots show how much to trust each line. “Map data” and “Forecast” are not live observations.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
