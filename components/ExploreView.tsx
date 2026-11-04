"use client";

import { useState } from "react";
import { googleMapsPlace } from "@/lib/maps-links";
import { type NearbyKind, type NearbyPlace } from "@/lib/nearby";
import { Button } from "./ui/Button";
import { Select } from "@/components/ui/Select";
import { Glyph, KindGlyph, KindBadge } from "@/components/ui/Glyph";
import { SafeImg } from "@/components/ui/SafeImg";
import { DiscoverSection } from "@/components/explore/DiscoverSection";
import { BestInMonth } from "@/components/explore/BestInMonth";
import { ChipRow, SectionTitle, pill } from "@/components/explore/kit";
import { MoodTiles } from "@/components/explore/MoodTiles";
import { ExplorePlaceSearch } from "@/components/ExplorePlaceSearch";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { TripExplore } from "@/components/explore/TripExplore";
import { useSavedPlaces } from "@/lib/client/use-saved-places";
import { creditText } from "@/lib/place-photos/safety";
import { PlaceHours } from "@/components/place/PlaceHours";

export type ExploreSeasonTag = {
  id: string; place_name: string; lat: number; lng: number; category: string | null; good_months: number[]; reason: string | null; region: string | null;
  confidence: string | null; source_urls: string[] | null; distanceKm: number | null;
};
type Anchor = { id: string; label: string; lat: number; lng: number };
type Props = { guess?: { lat: number; lng: number } | null; tripId: string | null; anchors: Anchor[]; seasonTags: ExploreSeasonTag[]; month: number };

const DISCOVER: NearbyKind[] = ["food", "stay", "pharmacy", "fuel"];
const DISCOVER_LABEL: Record<string, string> = { sights: "Sights & views", food: "Food", stay: "Stays", pharmacy: "Pharmacies", fuel: "Fuel" };

/** A place counts as "researched" only if it has a source we can show. Rows from the developer starter file do not. */
export const isResearched = (t: Pick<ExploreSeasonTag, "confidence" | "source_urls">) => t.confidence === "researched" && (t.source_urls?.length ?? 0) > 0;

export function ExploreView({ guess = null, tripId, anchors, seasonTags, month }: Props) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [custom, setCustom] = useState<Anchor | null>(null);
  const [anchorId, setAnchorId] = useState(anchors[0]?.id ?? "");
  const [kind, setKind] = useState<NearbyKind>("food");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<NearbyPlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useSavedPlaces();
  const [mode, setMode] = useState<"region" | "place">(anchors.length > 0 ? "place" : "region");
  const [category, setCategory] = useState<ExploreCategoryId | "all">("all");

  const researched = seasonTags.filter(isResearched);

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

  const allAnchors = custom ? [custom, ...anchors] : anchors;

  async function discover(k: NearbyKind, target: string | Anchor = anchorId) {
    const a = typeof target === "string" ? allAnchors.find((x) => x.id === target) : target;
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

  /** Takes the person to the results they just asked for (no animation if they prefer none). */
  function goDiscover() {
    if (typeof document === "undefined") return;
    const el = document.getElementById("discover");
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => el?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" }));
  }

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="relative z-10 -mt-14 rounded-3xl border border-line bg-white p-4 shadow-float sm:p-5">
        <ExplorePlaceSearch onPick={(p) => { const a: Anchor = { id: "custom", label: p.name, lat: p.lat, lng: p.lng }; setCustom(a); setAnchorId(a.id); setMode("place"); void discover("food", a); goDiscover(); }} />
      </div>

      <MoodTiles value={category} onPick={(c) => { setCategory(category === c ? "all" : c); goDiscover(); }} />

      {tripId && (
        <TripExplore tripId={tripId} saved={saved} added={added} addError={addError}
          addIdea={async (p) => { await addIdea({ ...p, category: p.category ?? null }); }} />
      )}

      <BestInMonth guess={guess} anchors={allAnchors} month={month} tripId={tripId} saved={saved} added={added} addIdea={async (p) => { await addIdea({ ...p, category: p.category ?? null }); }} />

      <DiscoverSection
        tripId={tripId} anchors={allAnchors} anchorId={anchorId} onAnchorChange={(id) => { setAnchorId(id); if (places) void discover(kind, id); }}
        onPickPlace={(p) => { const a: Anchor = { id: "custom", label: p.name, lat: p.lat, lng: p.lng }; setCustom(a); setAnchorId(a.id); void discover("food", a); }}
        researched={researched} month={month} saved={saved} added={added} addError={addError}
        mode={mode} onMode={setMode} category={category} onCategory={setCategory} hideSearch
        addIdea={async (p) => { await addIdea({ ...p, category: p.category ?? null }); }}
      />


      <section aria-labelledby="around-heading" className="rounded-[2rem] border border-line bg-white p-5 sm:p-6">
        <div id="around-heading"><SectionTitle eyebrow="On the way" title={<>Food, stays &amp; fuel near {custom ? custom.label : anchors.length > 0 ? "your trip" : "a place"}</>}>Real places from OpenStreetMap, closest first. We show no prices or ratings because we have no source for them; we don&apos;t guess.</SectionTitle></div>
        {allAnchors.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Pick a place above, or create a trip with a start or destination, to look around it.</p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              <div className="min-w-0 max-w-sm"><label htmlFor="explore-around" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Around</label><div className="mt-1"><Select id="explore-around" label="Explore around" value={anchorId} onChange={(v) => { setAnchorId(v); if (places) void discover(kind, v); }} options={allAnchors.map((a) => ({ value: a.id, label: a.label }))} className="!min-h-11 !text-sm font-normal" /></div></div>
              <ChipRow label="What to look for">
                {DISCOVER.map((k) => <button key={k} type="button" disabled={busy} aria-pressed={places !== null && kind === k} onClick={() => void discover(k)} className={`${pill(places !== null && kind === k)} disabled:opacity-60`}><KindGlyph kind={k} size={16} />{DISCOVER_LABEL[k]}</button>)}
              </ChipRow>
            </div>
            <div aria-live="polite" className="mt-3">
              {busy && <p className="text-sm text-ink-muted">Looking…</p>}
              {error && <p role="alert" className="text-sm font-semibold text-clay-ink">{error} <Button size="sm" variant="ghost" onClick={() => void discover(kind)}>Try again</Button></p>}
              {!busy && places && places.length > 0 && kind === "sights" && <p className="mb-2 text-xs text-ink-muted">We haven&apos;t researched the best months for these places yet, so none are shown as &ldquo;in season&rdquo;. Check the weather before you go.</p>}
              {!busy && places && places.length === 0 && <p className="text-sm text-ink-muted">Nothing found here. The map may list few places in this area.</p>}
              {!busy && places && places.length > 0 && (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {places.map((p) => (
                    <li key={p.id} className="flex gap-3 rounded-xl border border-line p-3 text-sm">
                      {p.photo ? (
                        <SafeImg src={p.photo.url} srcSet={p.photo.srcSet} sizes="64px" alt={`Photo of ${p.name}`} width={64} height={64} className="h-16 w-16 shrink-0 rounded-lg object-cover" fallback={<KindBadge kind={p.kind} size={64} />} />
                      ) : <KindBadge kind={p.kind} size={64} />}
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold text-pine">{p.name}{p.notable && <span className="ml-2 align-middle rounded-full bg-teal-light px-2 py-0.5 text-[11px] font-semibold text-teal-ink">Well known</span>}</p>
                        <p className="text-xs text-ink-muted">{p.km} km away{kind !== "sights" && p.hours && ` · Hours on the map (unconfirmed): ${p.hours}`}</p>
                        {kind === "sights" && (
                          <details className="mt-1"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-teal-ink">Opening hours</summary>
                            <PlaceHours place={{ name: p.name, lat: p.lat, lng: p.lng, kind: "sight", osm: /^(node|way|relation)\/\d+$/.test(p.id.replace(/^osm:/, "")) ? p.id.replace(/^osm:/, "") : null }} />
                          </details>
                        )}
                        {p.photo?.creditUrl && <a href={p.photo.creditUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-[11px] text-ink-muted underline underline-offset-2">{p.photo.licence ? creditText(p.photo) : "Photo: Wikimedia"}<span className="sr-only"> (opens in a new tab)</span></a>}
                        <div className="mt-1 flex flex-wrap gap-x-4">
                          <a href={googleMapsPlace(p)} target="_blank" rel="noopener noreferrer" className="tm-action min-h-11 py-1.5 font-semibold">Google Maps<span className="sr-only"> for {p.name} (opens in a new tab)</span></a>
                          {tripId && (added.has(p.id) ? <span className="py-1.5 font-semibold text-teal-ink"><span className="inline-flex items-center gap-1.5"><Glyph name="check" size={16} />Added</span></span> : <button type="button" onClick={() => void addIdea({ key: p.id, name: p.name, lat: p.lat, lng: p.lng, category: kind === "sights" ? "other" : kind === "food" ? "food" : kind === "stay" ? "stay" : null })} className="tm-action min-h-11 py-1.5 font-semibold">Add to ideas</button>)}
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
