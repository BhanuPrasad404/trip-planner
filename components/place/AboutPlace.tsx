"use client";

// "About this place": tap to learn what the place is and why people go. The write-up comes from Wikipedia and is shown only when the page is
// really about THIS place (name and position both agree, checked on the server); it is credited and linked. Under it, a few GENERAL tips for
// that kind of place, labelled as general. With no write-up it says so plainly and still shows what we do hold (kind, heritage listing,
// hours, website). Nothing is made up.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { PickerSheet } from "@/components/ui/Sheet";
import { exploreCategory } from "@/lib/explore/categories";
import type { AboutArticle } from "@/lib/place-about";

export type AboutPlaceRef = { name: string; lat: number; lng: number; category?: string | null; wikipedia?: string | null; wikidata?: string | null; heritage?: boolean; hours?: string | null; website?: string | null };
type Answer = { article: AboutArticle | null; unavailable: boolean; tips: { heading: string; items: string[] } | null };

const known = new Map<string, Answer>();
const keyOf = (p: AboutPlaceRef) => `${p.name}|${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

async function fetchAbout(p: AboutPlaceRef, signal?: AbortSignal): Promise<Answer> {
  const res = await fetch("/api/place-about", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ name: p.name, lat: p.lat, lng: p.lng, ...(p.wikipedia ? { wikipedia: p.wikipedia } : {}), ...(p.wikidata ? { wikidata: p.wikidata } : {}), ...(p.category ? { category: p.category } : {}) }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Couldn't load this right now.");
  return body as Answer;
}

/** The button, and the sheet it opens. Put it under a place on any screen. */
export function AboutPlace({ place, className = "tm-action", label = "About this place" }: { place: AboutPlaceRef; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={className}>
        <Glyph name="info" size={16} />{label}<span className="sr-only"> for {place.name}</span>
      </button>
      {open && <AboutSheet place={place} onClose={() => setOpen(false)} />}
    </>
  );
}

function AboutSheet({ place, onClose }: { place: AboutPlaceRef; onClose: () => void }) {
  const key = keyOf(place);
  const [state, setState] = useState<{ key: string; answer: Answer | null; error: string | null }>({ key, answer: known.get(key) ?? null, error: null });
  const [attempt, setAttempt] = useState(0);
  const settled = state.key === key && (state.answer !== null || state.error !== null);

  const load = useCallback((signal: AbortSignal) => {
    fetchAbout(place, signal)
      .then((a) => { if (!a.unavailable) known.set(key, a); setState({ key, answer: a, error: null }); })
      .catch((e) => { if (!signal.aborted) setState({ key, answer: null, error: e instanceof Error ? e.message : "Couldn't load this right now." }); });
  }, [place, key]);
  useEffect(() => {
    if (known.has(key)) return;
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new attempt or place is the only reason to ask again
  }, [key, attempt]);

  const a = state.key === key ? state.answer : null;
  const cat = place.category ? exploreCategory(place.category) : null;

  return (
    <PickerSheet title={`About ${place.name}`} onClose={onClose} footer={<Button variant="secondary" className="min-h-12 w-full" onClick={onClose}>Close</Button>}>
      <div className="space-y-5 px-4 py-4 text-sm" aria-live="polite">
        <div>
          <h3 className="break-words font-display text-xl font-semibold text-pine">{place.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {cat && <span className="rounded-full bg-teal-light px-2.5 py-1 text-xs font-semibold text-teal-ink">{cat.label}</span>}
            {place.heritage && <span className="rounded-full bg-marigold-light px-2.5 py-1 text-xs font-semibold text-marigold-ink">Heritage listed</span>}
            {a?.article?.description && <span className="rounded-full bg-sky px-2.5 py-1 text-xs font-semibold text-ink-muted">{a.article.description}</span>}
          </div>
        </div>

        {!settled && (
          <div aria-busy="true" aria-label="Loading" className="space-y-2">
            {[100, 92, 96, 60].map((w) => <div key={w} className="h-3.5 animate-pulse rounded bg-sky motion-reduce:animate-none" style={{ width: `${w}%` }} />)}
          </div>
        )}
        {state.key === key && state.error && (
          <p role="alert" className="rounded-2xl bg-clay-light px-4 py-3 font-semibold text-clay-ink">{state.error} <button type="button" onClick={() => { setState({ key, answer: null, error: null }); setAttempt((n) => n + 1); }} className="ml-1 min-h-11 underline underline-offset-2">Try again</button></p>
        )}
        {a?.unavailable && (
          <p role="status" className="rounded-2xl bg-sky px-4 py-3 text-ink-muted">We couldn&apos;t reach Wikipedia just now. <button type="button" onClick={() => { known.delete(key); setState({ key, answer: null, error: null }); setAttempt((n) => n + 1); }} className="min-h-11 font-semibold text-teal-ink underline underline-offset-2">Try again</button></p>
        )}

        {a?.article && (
          <section aria-label="What it is">
            <div className="space-y-2 text-base leading-relaxed text-ink">{a.article.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
            <p className="mt-2 text-xs text-ink-muted">From <a href={a.article.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-ink underline underline-offset-2">Wikipedia: {a.article.title}<span className="sr-only"> (opens in a new tab)</span></a> · text available under CC BY-SA 4.0</p>
            <a href={a.article.url} target="_blank" rel="noopener noreferrer" className="tm-action mt-2">Read the full article<Glyph name="external" size={15} /></a>
          </section>
        )}
        {a && !a.article && !a.unavailable && (
          <p className="rounded-2xl bg-sky px-4 py-3 text-ink-muted">We don&apos;t have a write-up for this place yet, and we won&apos;t guess. Here is what we do know.</p>
        )}

        {a && (place.hours || place.website || place.heritage || cat) && (
          <section aria-label="At a glance">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">At a glance</h4>
            <dl className="mt-1.5 divide-y divide-line rounded-2xl border border-line">
              {cat && <div className="flex gap-3 px-3 py-2.5"><dt className="w-24 shrink-0 text-ink-muted">Kind</dt><dd className="font-semibold text-pine">{cat.label}</dd></div>}
              {place.heritage && <div className="flex gap-3 px-3 py-2.5"><dt className="w-24 shrink-0 text-ink-muted">Listing</dt><dd className="text-pine">Marked as a heritage site on OpenStreetMap</dd></div>}
              {place.hours && <div className="flex gap-3 px-3 py-2.5"><dt className="w-24 shrink-0 text-ink-muted">Hours</dt><dd className="min-w-0 break-words text-pine">{place.hours}<span className="block text-xs text-ink-muted">As written on the map, not confirmed</span></dd></div>}
              {place.website && <div className="flex gap-3 px-3 py-2.5"><dt className="w-24 shrink-0 text-ink-muted">Website</dt><dd className="min-w-0 break-words"><a href={place.website} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-teal-ink underline underline-offset-2">{hostOf(place.website)}<span className="sr-only"> (opens in a new tab)</span></a></dd></div>}
            </dl>
          </section>
        )}

        {a?.tips && (
          <section aria-label="Good to know">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{a.tips.heading}</h4>
            <ul className="mt-1.5 space-y-2">
              {a.tips.items.map((t) => <li key={t} className="flex gap-2.5"><span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal" /><span>{t}</span></li>)}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">These are general tips for this kind of place, not facts about this one. Check locally before you go.</p>
          </section>
        )}
      </div>
    </PickerSheet>
  );
}

function hostOf(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Website"; } }
