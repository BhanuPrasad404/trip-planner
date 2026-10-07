"use client";

import { useState } from "react";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { googleMapsPlace } from "@/lib/maps-links";
import { type NearbyKind, type NearbyPlace } from "@/lib/nearby";
import { Button } from "./ui/Button";
import { Glyph, CategoryGlyph, KindGlyph, KindBadge } from "@/components/ui/Glyph";

export type ExploreSeasonTag = {
  id: string; place_name: string; lat: number; lng: number; category: string | null; good_months: number[]; reason: string | null; region: string | null;
  confidence: string | null; source_urls: string[] | null; distanceKm: number | null;
};
type Anchor = { id: string; label: string; lat: number; lng: number };
type Props = { tripId: string | null; anchors: Anchor[]; seasonTags: ExploreSeasonTag[]; month: number };

const MONTH = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });
const DISCOVER: NearbyKind[] = ["sights", "food", "stay", "pharmacy", "fuel"];
const DISCOVER_LABEL: Record<string, string> = { sights: "Sights & views", food: "Food", stay: "Stays", pharmacy: "Pharmacies", fuel: "Fuel" };

/** A place counts as "researched" only if it has a source we can show. Rows from the developer starter file do not. */
export const isResearched = (t: Pick<ExploreSeasonTag, "confidence" | "source_urls">) => t.confidence === "researched" && (t.source_urls?.length ?? 0) > 0;
const isYearRound = (t: Pick<ExploreSeasonTag, "good_months">) => new Set(t.good_months).size >= 12;

export function ExploreView({ tripId, anchors, seasonTags, month }: Props) {
  const [cat, setCat] = useState<string | null>(null);
  const [showOut, setShowOut] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState(anchors[0]?.id ?? "");
  const [kind, setKind] = useState<NearbyKind>("sights");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<NearbyPlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const researched = seasonTags.filter(isResearched);
  const unverified = seasonTags.filter((t) => !isResearched(t));
  const pool = showUnverified ? seasonTags : researched;
  const regions = [...new Set(researched.map((t) => t.region).filter((r): r is string => !!r))].sort();
  const inSeason = pool.filter((t) => t.good_months.includes(month));
  const out = pool.filter((t) => !t.good_months.includes(month));
  const cats = [...new Set(pool.map((t) => normalizeCategory(t.category)))];
  const matches = (t: ExploreSeasonTag) => !cat || normalizeCategory(t.category) === cat;
  const list = (showOut ? [...inSeason, ...out] : inSeason).filter(matches);

  async function addIdea(p: { key: string; name: string; lat: number; lng: number; category?: string | null; seasonId?: string; note?: string }) {
    if (!tripId) return;
    setAddError(null);
    const res = await fetch("/api/places/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trip_id: tripId, places: [{ name: p.name, lat: p.lat, lng: p.lng, category: p.category ?? null, source_type: "search", season_tag_id: p.seasonId ?? null, notes: p.note ?? null }] }),
    }).catch(() => null);
    if (!res || !res.ok) return setAddError((await res?.json().catch(() => null))?.error ?? "Couldn't add that to your ideas.");
    setAdded((s) => new Set(s).add(p.key));
  }

  async function discover(k: NearbyKind, id = anchorId) {
    const a = anchors.find((x) => x.id === id);
    if (!a) return;
    setKind(k); setBusy(true); setError(null);
    try {
      const res = await fetch("/api/nearby", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: k, lat: a.lat, lng: a.lng, radius_km: k === "sights" ? 25 : 8 }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't search right now.");
      setPlaces(body.places as NearbyPlace[]);
    } catch (e) {
      setPlaces(null);
      setError(e instanceof Error ? e.message : "Couldn't search right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="season-heading">
        <h2 id="season-heading" className="font-display text-2xl font-semibold text-pine">Best in {MONTH(month)}</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">Places at their best this month, from season data we researched, each with its source. {researched.length > 0 ? <>Covers {researched.length} places in {regions.join(" and ")} so far — it grows region by region.</> : <>No researched places are available yet.</>}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by type">
          <button type="button" aria-pressed={cat === null} onClick={() => setCat(null)} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${cat === null ? "border-pine bg-pine text-white" : "border-line bg-white text-ink-muted"}`}>All</button>
          {cats.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${cat === c ? "border-pine bg-pine text-white" : "border-line bg-white text-ink-muted"}`}><CategoryGlyph category={c} size={15} className="mr-1.5 inline align-text-bottom" />{CATEGORIES[c].label}</button>)}
          <label className="ml-auto inline-flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={showOut} onChange={(e) => setShowOut(e.target.checked)} /> Also show out-of-season</label>
          {unverified.length > 0 && <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={showUnverified} onChange={(e) => setShowUnverified(e.target.checked)} /> Also show {unverified.length} unverified</label>}
        </div>

        {addError && <p role="alert" className="mt-2 text-sm font-semibold text-clay-ink">{addError}</p>}
        {list.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line bg-white/70 p-6 text-sm text-ink-muted">{pool.length === 0 ? "No season data is available yet." : `Nothing in this filter is at its best in ${MONTH(month)}. Try another type, or show out-of-season places.`}</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => {
              const c = CATEGORIES[normalizeCategory(t.category)];
              const good = t.good_months.includes(month);
              const yearRound = isYearRound(t);
              const verified = isResearched(t);
              const key = `season-${t.id}`;
              return (
                <li key={t.id} className="flex flex-col rounded-2xl border border-line bg-white p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="break-words font-display text-lg font-semibold text-pine"><CategoryGlyph category={normalizeCategory(t.category)} size={18} className="mr-1.5 inline align-text-bottom text-teal" />{t.place_name}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${yearRound ? "bg-sky text-ink-muted" : good ? "bg-teal-light text-teal-ink" : "bg-clay-light text-clay-ink"}`}>{yearRound ? "No seasonal pattern" : good ? "In season" : "Out of season"}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">{c.label}{t.region && ` · ${t.region}`}{t.distanceKm !== null && ` · ${Math.round(t.distanceKm)} km from ${anchors[0]?.label ?? "your trip"}`}</p>
                  {t.reason && <p className="mt-2 text-sm leading-relaxed">{t.reason}</p>}
                  {yearRound ? <p className="mt-2 font-mono text-[11px] text-ink-muted">Listed as open to visit all year</p> : <p className="mt-2 font-mono text-[11px] text-ink-muted">Best: {t.good_months.map((m) => MONTH(m).slice(0, 3)).join(", ")}</p>}
                  {!verified && <p className="mt-1 text-xs font-semibold text-clay-ink">Unverified starter data — no source, not researched.</p>}
                  {t.source_urls?.[0] && <p className="mt-1 text-xs text-ink-muted">{t.confidence === "researched" ? "Researched" : "Draft"} · <a href={t.source_urls[0]} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">{new URL(t.source_urls[0]).hostname.replace(/^www\./, "")}<span className="sr-only"> (opens in a new tab)</span></a></p>}
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-sm">
                    <a href={googleMapsPlace(t)} target="_blank" rel="noopener noreferrer" className="min-h-9 py-1.5 font-semibold text-teal-ink underline underline-offset-2">Open in Google Maps<span className="sr-only"> (opens in a new tab)</span></a>
                    {tripId && (added.has(key) ? <span className="font-semibold text-teal-ink"><span className="inline-flex items-center gap-1.5"><Glyph name="check" size={16} />Added to Ideas</span></span> : <button type="button" onClick={() => void addIdea({ key, name: t.place_name, lat: t.lat, lng: t.lng, category: t.category, seasonId: t.id })} className="min-h-9 py-1.5 font-semibold text-pine underline underline-offset-2">Add to my ideas</button>)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="around-heading" className="rounded-3xl border border-line bg-white p-5 sm:p-6">
        <h2 id="around-heading" className="font-display text-2xl font-semibold text-pine">Around {anchors.length > 0 ? "your trip" : "a place"}</h2>
        <p className="mt-1 text-sm text-ink-muted">Real places from OpenStreetMap, with photos only where a real one exists. Price and rating filters will appear once a source for them is connected — we don&apos;t guess.</p>
        {anchors.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Create a trip with a start or destination to explore around it.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-sm font-semibold text-pine">Around <select value={anchorId} onChange={(e) => { setAnchorId(e.target.value); if (places) void discover(kind, e.target.value); }} className="ml-1 min-h-10 rounded-lg border border-line bg-white px-2 text-sm font-normal">{anchors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="What to look for">
                {DISCOVER.map((k) => <button key={k} type="button" disabled={busy} aria-pressed={places !== null && kind === k} onClick={() => void discover(k)} className={`min-h-10 rounded-full border px-3 text-sm font-semibold disabled:opacity-60 ${places !== null && kind === k ? "border-teal bg-teal-light text-teal-ink" : "border-line bg-white text-ink-muted hover:border-teal"}`}><KindGlyph kind={k} size={15} className="mr-1.5 inline align-text-bottom" />{DISCOVER_LABEL[k]}</button>)}
              </div>
            </div>
            <div aria-live="polite" className="mt-3">
              {busy && <p className="text-sm text-ink-muted">Looking…</p>}
              {error && <p role="alert" className="text-sm font-semibold text-clay-ink">{error} <Button size="sm" variant="ghost" onClick={() => void discover(kind)}>Try again</Button></p>}
              {!busy && places && places.length === 0 && <p className="text-sm text-ink-muted">Nothing found here. The map may list few places in this area.</p>}
              {!busy && places && places.length > 0 && (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {places.map((p) => (
                    <li key={p.id} className="flex gap-3 rounded-xl border border-line p-3 text-sm">
                      {p.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- real photo (traveler / Wikimedia), lazy-loaded
                        <img src={p.photo.url} alt={`Photo of ${p.name}`} width={64} height={64} loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                      ) : <KindBadge kind={p.kind} size={64} />}
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold text-pine">{p.name}</p>
                        <p className="text-xs text-ink-muted">{p.km} km away{p.hours && ` · ${p.hours}`}</p>
                        <div className="mt-1 flex flex-wrap gap-x-4">
                          <a href={googleMapsPlace(p)} target="_blank" rel="noopener noreferrer" className="min-h-9 py-1.5 font-semibold text-teal-ink underline underline-offset-2">Google Maps<span className="sr-only"> for {p.name} (opens in a new tab)</span></a>
                          {tripId && (added.has(p.id) ? <span className="py-1.5 font-semibold text-teal-ink"><span className="inline-flex items-center gap-1.5"><Glyph name="check" size={16} />Added</span></span> : <button type="button" onClick={() => void addIdea({ key: p.id, name: p.name, lat: p.lat, lng: p.lng, category: kind === "sights" ? "other" : kind === "food" ? "food" : kind === "stay" ? "stay" : null })} className="min-h-9 py-1.5 font-semibold text-pine underline underline-offset-2">Add to ideas</button>)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
