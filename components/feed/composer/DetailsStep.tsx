"use client";

import { appendChip, CAPTION_MAX, CONDITION_CHIPS, WHEN_OPTIONS, capturedAtFor, type WhenId } from "@/lib/feed/compose";
import { freshnessOf } from "@/lib/social/freshness";

type Props = {
  caption: string;
  when: WhenId;
  hasMedia: boolean;
  onCaption: (c: string) => void;
  onWhen: (w: WhenId) => void;
};

const dot = { green: "bg-emerald-500", amber: "bg-marigold", grey: "bg-ink-muted/60" } as const;

export function DetailsStep({ caption, when, hasMedia, onCaption, onWhen }: Props) {
  const now = new Date();
  const iso = capturedAtFor(when, now);
  const f = freshnessOf(iso ?? now, iso, now);
  const left = CAPTION_MAX - caption.length;

  return (
    <div className="tm-rise space-y-6">
      <div>
        <label htmlFor="caption" className="block text-sm font-semibold text-pine">{hasMedia ? "What should the next traveler know?" : "What are you seeing right now?"}</label>
        <div className="relative mt-2">
          <textarea id="caption" value={caption} onChange={(e) => onCaption(e.target.value)} maxLength={CAPTION_MAX} rows={4}
            placeholder={hasMedia ? "Water level, crowd, the road in, best time to go…" : "Road is clear, light rain, parking full by 10…"}
            className="w-full resize-none rounded-2xl border border-line px-4 pb-8 pt-3.5 text-base leading-relaxed outline-none focus:border-teal focus:ring-4 focus:ring-teal/20" />
          <span className={`pointer-events-none absolute bottom-2.5 right-4 text-xs tabular-nums ${left < 30 ? "text-clay-ink" : "text-ink-muted"}`} aria-live="off">{caption.length}/{CAPTION_MAX}</span>
        </div>
        <div className="mt-3" role="group" aria-label="Quick conditions">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Tap to add</p>
          <div className="flex flex-wrap gap-2">
            {CONDITION_CHIPS.map((c) => {
              const on = caption.toLowerCase().includes(c.toLowerCase());
              return <button key={c} type="button" onClick={() => onCaption(appendChip(caption, c))} aria-pressed={on} className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors ${on ? "border-teal bg-teal text-white" : "border-line bg-white text-ink-muted hover:border-teal/50 hover:text-teal-ink"}`}>{c}</button>;
            })}
          </div>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-pine">When was this?</legend>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {WHEN_OPTIONS.map((w) => (
            <label key={w.id} className={`flex min-h-11 cursor-pointer items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors ${when === w.id ? "border-teal bg-teal-light/60 text-pine" : "border-line text-ink-muted hover:border-teal/40"}`}>
              <input type="radio" name="when" value={w.id} checked={when === w.id} onChange={() => onWhen(w.id)} className="sr-only" />{w.label}
            </label>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-sky/70 px-3 py-2.5 text-sm text-ink-muted" aria-live="polite">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot[f.dot]}`} aria-hidden="true" />
          <span>Travelers will see it as <strong className="text-pine">{f.usableAsCurrent ? `Current · ${f.label}` : f.label}</strong>{f.usableAsCurrent ? "" : " — so nobody mistakes it for today’s conditions."}</span>
        </p>
      </fieldset>
    </div>
  );
}
