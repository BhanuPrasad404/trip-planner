"use client";

import { useMemo, useRef, useState } from "react";
import { fileToDataUrl } from "@/lib/client/image";
import { getSeasonStatus, visitMonth } from "@/lib/season";
import type { ImportCandidate } from "@/lib/import/pipeline";
import { SeasonBadge } from "./SeasonBadge";
import { Button } from "./ui/Button";
import { FormError } from "./ui/Field";
import { Glyph, CategoryGlyph } from "@/components/ui/Glyph";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { usePlacePhotos } from "@/lib/client/use-place-photos";

type Props = {
  tripId: string;
  startDate: string | null;
  today: string;
  /** Opens on the "Describe my trip" tab with this text (used by "Find alternatives"). */
  initialBrief?: string;
  onDone: (added: number) => void;
  onCancel: () => void;
};

type Tab = "paste" | "brief";
type Phase = "form" | "loading" | "review";

const sourceLabel: Record<ImportCandidate["source"], string> = {
  maps_link: "From Maps link",
  ai_text: "Found in your text",
  screenshot: "Found in screenshot",
  ai_suggestion: "AI suggestion",
};

export function ImportPanel({ tripId, startDate, today, initialBrief, onDone, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>(initialBrief ? "brief" : "paste");
  const [phase, setPhase] = useState<Phase>("form");
  const [text, setText] = useState(initialBrief ?? "");
  const [images, setImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const month = visitMonth(startDate, null, today);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const next = [...images];
      for (const f of Array.from(files)) {
        if (next.length >= 3) break;
        next.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
      }
      setImages(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function analyse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("loading");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          mode: tab === "brief" ? "suggest" : "extract",
          text,
          images: tab === "paste" ? images.map((i) => i.dataUrl) : [],
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't analyse that. Please try again.");
        setPhase("form");
        return;
      }
      const list: ImportCandidate[] = body.candidates ?? [];
      setCandidates(list);
      setNotes(body.notes ?? []);
      // Far-away matches (likely the wrong place) start UNticked; the user can still opt in.
      setSelected(new Set(list.filter((c) => c.lat != null && !c.duplicate && !c.far).map((c) => c.key)));
      setPhase("review");
    } catch {
      setError("Network problem — check your connection and try again.");
      setPhase("form");
    }
  }

  async function save() {
    const chosen = candidates.filter((c) => selected.has(c.key) && c.lat != null && c.lng != null);
    if (chosen.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/places/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          places: chosen.map((c) => ({
            name: c.name,
            lat: c.lat,
            lng: c.lng,
            category: c.category,
            source_type: c.source,
            source_url: c.sourceUrl && /^https?:\/\//.test(c.sourceUrl) ? c.sourceUrl : null,
            season_tag_id: c.seasonTagId,
            notes: c.note,
            address: c.address,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't add those places.");
        return;
      }
      onDone(body.added ?? chosen.length);
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Real photos of the found places, filled in after the list is on screen. Only places we could locate are looked up.
  const photoQueries = useMemo(() => candidates.filter((c) => c.lat != null && c.lng != null).map((c) => ({ key: c.key, name: c.name, lat: c.lat as number, lng: c.lng as number })), [candidates]);
  const photos = usePlacePhotos(photoQueries);
  const canAnalyse = tab === "brief" ? text.trim().length >= 10 : text.trim().length > 0 || images.length > 0;

  return (
    <section aria-labelledby="import-heading" className="rounded-3xl border border-teal/30 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id="import-heading" className="font-display text-xl font-semibold text-pine">
          {phase === "review" ? "Review what we found" : "Add places the smart way"}
        </h2>
        <button type="button" onClick={onCancel} className="min-h-10 px-2 text-sm font-semibold text-ink-muted underline underline-offset-2">
          Close
        </button>
      </div>

      {phase !== "review" && (
        <form onSubmit={analyse} className="mt-4 space-y-4">
          <div role="tablist" aria-label="How do you want to add places?" className="grid grid-cols-2 gap-1 rounded-xl bg-sky p-1">
            {(
              [
                ["paste", "Paste links, text or screenshots"],
                ["brief", "Describe my trip"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${tab === id ? "bg-white text-pine shadow-sm" : "text-ink-muted"}`}
              >
                {id === "brief" && <Glyph name="sparkles" size={15} className="mr-1.5 inline align-text-bottom" />}{label}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="import-text" className="block text-sm font-semibold">
              {tab === "paste" ? "Paste anything" : "Tell us about the trip"}
            </label>
            <textarea
              id="import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={6000}
              placeholder={
                tab === "paste"
                  ? "Google Maps links, a reel caption, a WhatsApp message listing places…"
                  : "e.g. 4 friends from Hyderabad, monsoon weekend, we love waterfalls and easy treks, budget stay"
              }
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/40"
            />
            <p className="mt-1.5 text-sm text-ink-muted">
              {tab === "paste"
                ? "Instagram and YouTube block automatic link reading — paste the caption or add a screenshot of the reel."
                : "We suggest real places that suit your travel month and start city. You review everything before it's added."}
            </p>
          </div>

          {tab === "paste" && (
            <div>
              <input ref={fileInput} id="import-files" type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
              <label htmlFor="import-files" className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-dashed border-teal/50 px-4 text-sm font-semibold text-teal-ink hover:bg-teal-light">
                <Glyph name="camera" size={16} className="mr-2" />Add screenshots ({images.length}/3)
              </label>
              {images.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {images.map((img, i) => (
                    <li key={img.dataUrl.slice(-24) + i} className="flex items-center gap-2 rounded-lg bg-sky px-2.5 py-1.5 text-sm">
                      <span className="max-w-40 truncate">{img.name}</span>
                      <button type="button" aria-label={`Remove ${img.name}`} onClick={() => setImages(images.filter((_, j) => j !== i))} className="font-bold text-clay-ink">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <FormError message={error} />

          <Button type="submit" disabled={!canAnalyse || phase === "loading"} className="w-full sm:w-auto">
            {phase === "loading" ? "Finding places… this can take a few seconds" : tab === "brief" ? "Suggest places" : "Find places"}
          </Button>
          <p aria-live="polite" className="sr-only">{phase === "loading" ? "Finding places" : ""}</p>
        </form>
      )}

      {phase === "review" && (
        <div className="mt-4 space-y-4">
          {notes.map((n) => (
            <p key={n} className="rounded-xl bg-marigold-light px-4 py-3 text-sm text-[#7a4a00]">{n}</p>
          ))}

          {candidates.length === 0 ? (
            <p className="py-4 text-center text-base text-ink-muted">Nothing found. Go back and try different text.</p>
          ) : (
            <ul className="space-y-3">
              {candidates.map((c) => {
                const addable = c.lat != null && c.lng != null;
                const status = c.seasonGoodMonths ? getSeasonStatus(c.seasonGoodMonths, month) : null;
                return (
                  <li key={c.key} className={`rounded-2xl border p-3.5 ${selected.has(c.key) ? "border-teal bg-teal-light/40" : "border-line"}`}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        disabled={!addable}
                        checked={selected.has(c.key)}
                        onChange={() => toggle(c.key)}
                        className="mt-1 h-5 w-5 shrink-0 accent-[#1c7c6d]"
                      />
                      <PlacePhoto photo={photos[c.key]} name={c.name} className="h-20 w-20 sm:h-24 sm:w-24" credit fallback={<CategoryGlyph category={c.category} size={28} />} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold">{c.name}</span>
                        {c.area && <span className="block text-sm text-ink-muted">{c.area}</span>}
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-sky px-2.5 py-1 font-semibold text-ink-muted">{c.source === "ai_suggestion" && <Glyph name="sparkles" size={12} className="mr-1 inline align-text-bottom" />}{sourceLabel[c.source]}{c.source === "ai_suggestion" ? " · double-check" : ""}</span>
                          {status && <SeasonBadge status={status} />}
                        </span>
                        {c.note && <span className="mt-1.5 block text-sm text-ink-muted">{c.note}</span>}
                        {c.warnings.filter((w) => !w.startsWith("AI suggestion")).map((w) => (
                          <span key={w} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-clay-ink"><Glyph name="warn" size={14} className="mt-0.5" />{w}</span>
                        ))}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <FormError message={error} />

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setPhase("form")} disabled={saving}>Back</Button>
            <Button onClick={save} disabled={saving || selected.size === 0}>
              {saving ? "Adding…" : `Add ${selected.size} to Ideas`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
