"use client";

import { PACES, PACE_LABEL, type Pace, type TravelPrefs } from "@/lib/trip/preferences";

/**
 * How the traveller likes to travel. Theirs alone: saved on this phone, changed only when they change it. It shapes suggestions; it never
 * hides a safety warning (a hill road after dark is never recommended, whatever is chosen here).
 */
export function TravelPrefsCard({ prefs, onChange }: { prefs: TravelPrefs; onChange: (patch: Partial<TravelPrefs>) => void }) {
  return (
    <section aria-labelledby="prefs-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5" data-testid="travel-prefs">
      <details>
        <summary className="min-h-11 cursor-pointer select-none py-2"><h2 id="prefs-heading" className="inline font-display text-lg font-semibold text-pine">How I like to travel</h2></summary>
        <label className="mt-1 flex min-h-11 items-start gap-2 text-sm text-pine">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--teal)]" checked={prefs.nightDriving} onChange={(e) => onChange({ nightDriving: e.target.checked })} />
          <span>I&apos;m willing to drive at night if it helps. <span className="text-ink-muted">Hill roads after dark are never suggested either way.</span></span>
        </label>
        <label className="mt-2 block text-sm font-semibold text-pine">Pace of a day
          <select className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-2 text-sm font-normal" value={prefs.pace} onChange={(e) => onChange({ pace: e.target.value as Pace })}>
            {PACES.map((p) => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}
          </select>
        </label>
        <p className="mt-2 break-words text-xs text-ink-muted">Saved on this phone. We never change these for you; they only shape the suggestions we make.</p>
      </details>
    </section>
  );
}
