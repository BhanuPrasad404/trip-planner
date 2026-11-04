"use client";

// How the traveller likes to travel, with what each choice really does. Theirs alone: kept on THIS phone, changed only when they change
// it, never altered by anything the app learns. They shape the suggestions we make (when a day starts and ends, whether a night arrival
// may be proposed). They never edit the plan on their own, and never make a safety finding go away (a hill road after dark is never
// recommended, whatever is chosen here).
import { Glyph } from "@/components/ui/Glyph";
import { PACES, PACE_WINDOW, type Pace, type TravelPrefs } from "@/lib/trip/preferences";

const clock = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`; };
const PACE_INFO: Record<Pace, { name: string; effect: string }> = {
  relaxed: { name: "Relaxed", effect: "Later starts and earlier finishes, so there is more time at each place and fewer stops fit in a day." },
  balanced: { name: "Balanced", effect: "A reasonable mix of driving, sightseeing and rest." },
  brisk: { name: "Brisk", effect: "Earlier starts and later finishes, so more sightseeing fits into a day. Days are longer." },
};

export function TravelPrefsCard({ prefs, onChange }: { prefs: TravelPrefs; onChange: (patch: Partial<TravelPrefs>) => void }) {
  const w = PACE_WINDOW[prefs.pace];
  return (
    <section aria-labelledby="prefs-heading" className="rounded-3xl border border-line bg-white p-4 sm:p-5" data-testid="travel-prefs">
      <details>
        <summary className="tm-no-chevron flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-1 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <h2 id="prefs-heading" className="font-display text-xl font-semibold text-pine">How I like to travel</h2>
            <span className="mt-0.5 block text-sm text-ink-muted">{PACE_INFO[prefs.pace].name} pace · night driving {prefs.nightDriving ? "on" : "off"}</span>
          </span>
          <Glyph name="down" size={20} className="shrink-0 text-ink-muted" />
        </summary>

        <div className="mt-3 space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-2xl bg-sky px-4 py-3">
            <span className="min-w-0 text-sm">
              <span id="night-label" className="block font-semibold text-pine">Night driving</span>
              <span className="block text-ink-muted">I&apos;m comfortable driving after sunset when I need to. {prefs.nightDriving ? "Late arrivals can be suggested." : "We'll avoid suggesting late arrivals."}</span>
            </span>
            <button type="button" role="switch" aria-checked={prefs.nightDriving} aria-labelledby="night-label" onClick={() => onChange({ nightDriving: !prefs.nightDriving })}
              className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors ${prefs.nightDriving ? "bg-teal" : "bg-line"}`}>
              <span aria-hidden="true" className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${prefs.nightDriving ? "left-7" : "left-1"}`} />
              <span className="sr-only">{prefs.nightDriving ? "On" : "Off"}</span>
            </button>
          </div>

          <div>
            <p id="pace-label" className="text-sm font-semibold text-pine">Pace of a day</p>
            <div role="radiogroup" aria-labelledby="pace-label" className="mt-2 grid grid-cols-3 gap-2">
              {PACES.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={prefs.pace === p} onClick={() => onChange({ pace: p })}
                  className={`min-h-12 rounded-2xl border-2 px-2 text-sm font-semibold transition active:scale-[0.97] ${prefs.pace === p ? "border-pine bg-pine text-white" : "border-line bg-white text-pine hover:border-teal"}`}>{PACE_INFO[p].name}</button>
              ))}
            </div>
            <p className="mt-2 text-sm text-ink-muted">{PACE_INFO[prefs.pace].effect} <span className="text-pine">Days run about {clock(w.dayStartMin)} to {clock(w.dayEndMin)}.</span></p>
          </div>

          <ul className="space-y-1.5 text-xs text-ink-muted">
            <li className="flex gap-2"><Glyph name="info" size={14} className="mt-0.5 shrink-0" /><span>Saved on <strong className="text-pine">this phone only</strong>, not on your other devices.</span></li>
            <li className="flex gap-2"><Glyph name="info" size={14} className="mt-0.5 shrink-0" /><span>We never change your plan because of these. They only shape the suggestions we make from now on, and you approve any change.</span></li>
            <li className="flex gap-2"><Glyph name="warn" size={14} className="mt-0.5 shrink-0" /><span>Hill roads after dark are never suggested, whatever you choose.</span></li>
          </ul>
        </div>
      </details>
    </section>
  );
}
