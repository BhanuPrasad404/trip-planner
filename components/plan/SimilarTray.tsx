"use client";

// "Places like these": optional ideas with a reason and the real extra drive. Shown only after 2+ places; nothing is added by itself.
import { useEffect, useRef, useState } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Suggestion } from "@/lib/intake/similar";
import type { Interest } from "@/lib/intake/types";

type Input = { start: { lat: number; lng: number } | null; places: { id: string; name: string; lat: number; lng: number; kind: string; state: string | null; must: boolean }[]; interests: Interest[]; month: number | null; roundTrip: boolean };

export function SimilarTray({ input, onAdd, online }: { input: Input; onAdd: (s: Suggestion) => void; online: boolean }) {
  const [state, setState] = useState<{ key: string; status: "loading" | "done" | "error"; list: Suggestion[]; note: string | null } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const enough = !!input.start && input.places.length >= 2;
  const key = enough ? JSON.stringify([input.start, input.places.map((p) => [p.lat.toFixed(3), p.lng.toFixed(3)]), input.interests, input.month]) : "";

  useEffect(() => {
    if (!key || !online) return;
    const t = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController(); ctrl.current = c;
      setState({ key, status: "loading", list: [], note: null });
      fetch("/api/intake/similar", { method: "POST", headers: { "Content-Type": "application/json" }, signal: c.signal, body: JSON.stringify({ start: input.start, places: input.places, interests: input.interests, month: input.month, round_trip: input.roundTrip }) })
        .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok || !b) throw new Error(b?.error ?? "x"); setState({ key, status: "done", list: b.suggestions ?? [], note: b.note ?? null }); })
        .catch(() => { if (!c.signal.aborted) setState({ key, status: "error", list: [], note: null }); });
    }, 800);
    return () => clearTimeout(t);
  }, [key, online]); // eslint-disable-line react-hooks/exhaustive-deps -- the key covers the input
  useEffect(() => () => ctrl.current?.abort(), []);

  if (!enough) return null;
  const mine = state?.key === key ? state : null;
  return (
    <section aria-labelledby="similar-h" className="rounded-2xl border border-line bg-white p-4">
      <h3 id="similar-h" className="font-display text-lg font-semibold text-pine">Places like these</h3>
      <p className="text-sm text-ink-muted">Optional ideas near your trip. Nothing is added unless you tap Add.</p>
      {!online && <p className="mt-2 text-sm text-clay-ink">You&apos;re offline, so we can&apos;t look for similar places.</p>}
      {online && (!mine || mine.status === "loading") && (
        <div className="mt-3 space-y-2" aria-busy="true"><p className="text-sm text-ink-muted">Looking at the map near your places… the first time for an area this can take up to 20 seconds.</p><Skeleton className="h-16 w-full rounded-xl" /><Skeleton className="h-16 w-full rounded-xl" /></div>
      )}
      {mine?.status === "error" && <p className="mt-2 text-sm text-clay-ink">Couldn&apos;t look for similar places right now. Your plan works without them.</p>}
      {mine?.status === "done" && (
        <>
          {mine.list.length > 0 && (
            <ul className="mt-3 space-y-2">
              {mine.list.map((s) => (
                <li key={s.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold">{s.name}</p>
                    <p className="text-sm text-ink-muted">{s.reason}</p>
                    {s.extraDriveMin !== null && <p className="mt-0.5 text-xs text-ink-muted"><Glyph name="car" size={12} className="mr-1 inline align-text-bottom" />About +{s.extraDriveMin} min of driving ({s.extraKm} km){s.estimated ? ", estimated" : ""}</p>}
                  </div>
                  <button type="button" disabled={added.includes(s.id)} onClick={() => { setAdded((a) => [...a, s.id]); onAdd(s); }} className="min-h-11 shrink-0 rounded-xl border border-teal px-3.5 text-sm font-bold text-teal-ink disabled:border-line disabled:text-ink-muted">
                    {added.includes(s.id) ? "Added" : "Add"}<span className="sr-only"> {s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mine.note && <p className="mt-2 text-sm text-ink-muted">{mine.note}</p>}
          <p className="mt-2 text-[11px] text-ink-muted">From OpenStreetMap places linked to Wikipedia or Wikidata (© OpenStreetMap contributors), and Trailmate&apos;s own research.</p>
        </>
      )}
    </section>
  );
}
