"use client";

import { CONDITIONS, CROWD_LABEL, CROWD_LEVELS, LIMITS, VIBES, type CrowdLevel } from "@/lib/feed/experience";

type Props = {
  crowd: CrowdLevel | null; conditions: string[]; vibes: string[]; tip: string; wantsArea: boolean;
  onCrowd: (c: CrowdLevel | null) => void; onConditions: (c: string[]) => void; onVibes: (v: string[]) => void; onTip: (t: string) => void; onWantsArea: (b: boolean) => void;
};

const toggle = (list: string[], id: string, max: number) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= max ? list : [...list, id]);
const pill = (on: boolean) => `min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors ${on ? "border-teal bg-teal text-white" : "border-line bg-white text-ink-muted hover:border-teal/50 hover:text-teal-ink"}`;

/** Optional, one tap each. A post is great without any of this; with it, the next traveler can plan from it. */
export function ExperiencePicker(p: Props) {
  const filled = (p.crowd ? 1 : 0) + p.conditions.length + p.vibes.length + (p.tip.trim() ? 1 : 0);
  return (
    <details className="rounded-2xl border border-line open:bg-sky/30">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-pine">
        <span>Make it more useful <span className="font-normal text-ink-muted">· optional</span></span>
        <span className="text-xs font-normal text-ink-muted">{filled > 0 ? `${filled} added` : "Helps other travelers plan"}</span>
      </summary>
      <div className="space-y-5 px-4 pb-5 pt-1">
        <fieldset>
          <legend className="text-sm font-semibold text-pine">How crowded was it?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CROWD_LEVELS.map((c) => <button key={c} type="button" aria-pressed={p.crowd === c} onClick={() => p.onCrowd(p.crowd === c ? null : c)} className={pill(p.crowd === c)}>{CROWD_LABEL[c]}</button>)}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-pine">Conditions <span className="font-normal text-ink-muted">· up to {LIMITS.conditions}</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CONDITIONS.map((c) => { const on = p.conditions.includes(c.id); return <button key={c.id} type="button" aria-pressed={on} disabled={!on && p.conditions.length >= LIMITS.conditions} onClick={() => p.onConditions(toggle(p.conditions, c.id, LIMITS.conditions))} className={`${pill(on)} disabled:opacity-40`}>{c.label}</button>; })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-pine">What was special? <span className="font-normal text-ink-muted">· up to {LIMITS.vibes}</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {VIBES.map((v) => { const on = p.vibes.includes(v.id); return <button key={v.id} type="button" aria-pressed={on} disabled={!on && p.vibes.length >= LIMITS.vibes} onClick={() => p.onVibes(toggle(p.vibes, v.id, LIMITS.vibes))} className={`${pill(on)} disabled:opacity-40`}>{v.label}</button>; })}
          </div>
        </fieldset>

        <div>
          <label htmlFor="exp-tip" className="block text-sm font-semibold text-pine">One tip for the next traveler</label>
          <input id="exp-tip" value={p.tip} onChange={(e) => p.onTip(e.target.value)} maxLength={LIMITS.tipMax} placeholder="e.g. Go before 9 AM — parking fills up" className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-white px-4 text-base outline-none focus:border-teal focus:ring-4 focus:ring-teal/20" />
          {p.tip.trim().length > 0 && p.tip.trim().length < LIMITS.tipMin && <p className="mt-1 text-xs text-clay-ink">A tip needs a few words.</p>}
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-3.5 text-sm ring-1 ring-line">
          <input type="checkbox" checked={p.wantsArea} onChange={(e) => p.onWantsArea(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#1c7c6d]" />
          <span><strong className="text-pine">Show that I posted from the area</strong><span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">Checks once that your phone is near this destination, then shows a small badge. Your location is not saved. It can&apos;t prove you were there, so it&apos;s a hint, not a guarantee.</span></span>
        </label>
      </div>
    </details>
  );
}
