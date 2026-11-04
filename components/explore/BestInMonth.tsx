"use client";

// "Best in <month>" for whoever is looking: near their trip, near where they are, or in the state they pick (remembered on this phone).
// The places are chosen by the typical weather of that month (lib/explore/season-picks.ts); the numbers are shown with each one.
// Where we hold researched season data, that place says so and shows its source. Nothing here is the same list for everybody.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChipRow, Segmented, SectionTitle, pill } from "@/components/explore/kit";
import { CategoryGlyph, Glyph } from "@/components/ui/Glyph";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { Select } from "@/components/ui/Select";
import { useDeviceHere } from "@/lib/client/use-device-here";
import { usePlacePhotos } from "@/lib/client/use-place-photos";
import type { useSavedPlaces } from "@/lib/client/use-saved-places";
import { exploreCategoryLabel } from "@/lib/explore/categories";
import { plannerCategory } from "@/lib/explore/glyph";
import { VERDICT_WORD, type SeasonPick } from "@/lib/explore/season-picks";
import { REGIONS, regionByCode } from "@/lib/explore/regions";
import { googleMapsPlace } from "@/lib/maps-links";

type Saved = ReturnType<typeof useSavedPlaces>;
type Anchor = { id: string; label: string; lat: number; lng: number };
type Where = { kind: "trip" } | { kind: "guess" } | { kind: "here" } | { kind: "region"; code: string };
type Answer = { picks: SeasonPick[]; empty: null | "no_catalogue" | "no_places" | "no_weather"; candidates: number; basis: string; month: number };
type Props = { /** Where the visitor roughly is (from their network, city level), used only until they choose. */ guess?: { lat: number; lng: number } | null; anchors: Anchor[]; month: number; tripId: string | null; saved: Saved; added: Set<string>; addIdea: (p: { key: string; name: string; lat: number; lng: number; category?: string | null }) => Promise<void> };

const MONTH_LONG = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });
const MONTH_SHORT = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "short" });
const STORE = "tm-best-in-month-region";
const EMPTY_TEXT = { no_catalogue: "Our place list isn't reachable right now. Please try again in a moment.", no_places: "We have no well-known places to suggest here yet. Try a wider distance or another state.", no_weather: "We couldn't read the typical weather for this area just now, so we don't guess. Please try again in a moment." } as const;

function remembered(): string | null { try { const v = window.localStorage.getItem(STORE); return v && regionByCode(v) ? v : null; } catch { return null; } }
function remember(code: string) { try { window.localStorage.setItem(STORE, code); } catch { /* private window: it just isn't remembered */ } }

export function BestInMonth({ guess = null, anchors, month: thisMonth, tripId, saved, added, addIdea }: Props) {
  const trip = anchors[0] ?? null;
  const [picked, setWhere] = useState<Where | null>(null);
  // A state picked earlier on this phone is the starting point when there is no trip. Read on the phone only, so the server and phone agree.
  const home = useSyncExternalStore(() => () => undefined, remembered, () => null);

  const [month, setMonth] = useState(thisMonth);
  const [radius, setRadius] = useState<50 | 100>(50);
  const [answer, setAnswer] = useState<{ sig: string; data: Answer | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { here, request } = useDeviceHere();
  // Order: what they chose, their trip, a state they chose before, the phone's location if they already allowed it, their rough area.
  const where: Where | null = picked ?? (trip ? { kind: "trip" } : home ? { kind: "region", code: home } : here.status === "on" ? { kind: "here" } : guess ? { kind: "guess" } : null);

  useEffect(() => { if (where?.kind === "here" && here.status === "off") request(); }, [where, here.status, request]);

  const centre = where?.kind === "trip" && trip ? { lat: trip.lat, lng: trip.lng } : where?.kind === "here" && here.status === "on" ? { lat: here.lat, lng: here.lng } : where?.kind === "guess" && guess ? guess : null;
  const region = where?.kind === "region" ? where.code : null;
  const sig = region ? `r|${region}|${month}` : centre ? `p|${centre.lat.toFixed(2)},${centre.lng.toFixed(2)}|${radius}|${month}` : null;

  useEffect(() => {
    if (!sig) return;
    const ac = new AbortController();
    const body = region ? { region, month } : { lat: centre?.lat, lng: centre?.lng, radius_km: radius, month };
    fetch("/api/explore/season", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ac.signal })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(typeof j?.error === "string" ? j.error : "Couldn't load this right now."); return j as Answer; })
      .then((data) => setAnswer({ sig, data, error: null }))
      .catch((e) => { if (!(e instanceof DOMException && e.name === "AbortError")) setAnswer({ sig, data: null, error: e instanceof Error ? e.message : "Couldn't load this right now." }); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` already names every input
  }, [sig, attempt]);

  const current = answer && answer.sig === sig ? answer : null;
  const picks = useMemo(() => current?.data?.picks ?? [], [current]);
  const photos = usePlacePhotos(picks.map((p) => ({ key: `best-${p.item.id}`, name: p.item.name, lat: p.item.lat, lng: p.item.lng })));
  const loading = !!sig && !current;
  const months = [0, 1, 2, 3].map((n) => ((thisMonth - 1 + n) % 12) + 1);
  const areaName = region ? regionByCode(region)?.name : where?.kind === "trip" ? `${trip?.label}` : where?.kind === "here" ? "you" : where?.kind === "guess" ? "your area" : null;

  return (
    <section aria-labelledby="season-heading" className="overflow-hidden rounded-[2rem] bg-pine p-5 text-white sm:p-6">
      <div id="season-heading"><SectionTitle dark eyebrow="Picked for the month" title={<>Best in {MONTH_LONG(month)}{areaName ? <span className="text-white/70"> · near {areaName}</span> : null}</>}>
        Chosen from the typical weather of the month where each place is, so the list changes with where you are. Each pick shows the numbers behind it.{where?.kind === "guess" && " Based on your approximate area; tap Use my exact location or pick a state to change it."}
      </SectionTitle></div>

      <div className="mt-4"><ChipRow label="Where to look">
        {trip && <button type="button" aria-pressed={where?.kind === "trip"} onClick={() => setWhere({ kind: "trip" })} className={pill(where?.kind === "trip", true)}><Glyph name="pin" size={16} />Near my trip</button>}
        <button type="button" aria-pressed={where?.kind === "here"} disabled={here.status === "asking"} onClick={() => setWhere({ kind: "here" })} className={pill(where?.kind === "here", true)}><Glyph name="locate" size={16} />{here.status === "asking" && where?.kind === "here" ? "Asking…" : where?.kind === "guess" ? "Use my exact location" : "Near me"}</button>
        <button type="button" aria-pressed={where?.kind === "region"} onClick={() => setWhere({ kind: "region", code: remembered() ?? region ?? "" })} className={pill(where?.kind === "region", true)}>A state</button>
      </ChipRow></div>

      {where?.kind === "region" && (
        <div className="mt-3 max-w-sm">
          <label htmlFor="season-region" className="text-xs font-semibold uppercase tracking-wide text-white/75">State or union territory</label>
          <div className="mt-1"><Select id="season-region" label="State or union territory" value={where.code} placeholder="Choose…" onChange={(code) => { remember(code); setWhere({ kind: "region", code }); }} options={REGIONS.map((r) => ({ value: r.code, label: r.name, hint: r.kind === "ut" ? "Union territory" : undefined }))} /></div>
        </div>
      )}
      {where?.kind === "here" && here.status === "denied" && <p role="status" className="mt-3 text-sm text-white/80">Location is blocked in this browser. Pick a state instead.</p>}
      {where?.kind === "here" && here.status === "unavailable" && <p role="status" className="mt-3 text-sm text-white/80">We couldn&apos;t find your location just now. Pick a state instead.</p>}

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-[16rem] flex-1 sm:flex-none"><Segmented dark label="Month" value={month} options={months.map((m) => ({ value: m, label: m === thisMonth ? "Now" : MONTH_SHORT(m) }))} onChange={setMonth} /></div>
        {!region && <div className="min-w-[12rem] flex-1 sm:max-w-[14rem] sm:flex-none"><Segmented dark label="Within" value={radius} options={[{ value: 50 as const, label: "50 km" }, { value: 100 as const, label: "100 km" }]} onChange={setRadius} /></div>}
      </div>

      <div aria-live="polite" className="mt-4">
        {!sig && <p className="rounded-2xl border border-dashed border-white/30 bg-white/10 p-5 text-sm text-white/85">Pick where you are, or a state, to see what is best in {MONTH_LONG(month)}.</p>}
        {loading && <ul className="relative -mx-5 flex gap-3 overflow-hidden px-5 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3" aria-busy="true" aria-label="Loading the best places">{[0, 1, 2].map((i) => <li key={i} className="w-[78%] shrink-0 rounded-3xl border border-white/20 bg-white/10 p-2 sm:w-auto"><div className="aspect-[16/10] animate-pulse rounded-2xl bg-white/20 motion-reduce:animate-none" /><div className="h-16" /></li>)}</ul>}
        {current?.error && <p role="alert" className="rounded-2xl bg-clay-light p-4 text-sm font-semibold text-clay-ink">{current.error} <button type="button" onClick={() => { setAnswer(null); setAttempt((a) => a + 1); }} className="tm-action ml-1 min-h-11 font-semibold">Try again</button></p>}
        {current?.data && current.data.empty && <p className="rounded-2xl border border-dashed border-white/30 bg-white/10 p-5 text-sm text-white/85">{EMPTY_TEXT[current.data.empty]}</p>}
        {picks.length > 0 && (
          <PickRow>
            {picks.map((p) => <PickCard key={p.item.id} pick={p} photo={photos[`best-${p.item.id}`]} month={month} tripId={tripId} saved={saved} added={added} addIdea={addIdea} regionName={region ? regionByCode(region)?.name ?? null : null} />)}
          </PickRow>
        )}
        {picks.length > 0 && <p className="mt-3 text-xs text-white/75">How we pick: typical daily high and rain for {MONTH_LONG(month)} over six past years (Open-Meteo), matched to each kind of place. Places marked Researched also have a sourced note on their best months. A good month is not a promise for one particular day; check the forecast before you go.</p>}
      </div>
    </section>
  );
}

/** The swipe row on a phone, a grid on a larger screen. Positioned, so the screen-reader text inside its cards stays inside it. */
export function PickRow({ children }: { children: React.ReactNode }) {
  return <ul className="relative -mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3 [&::-webkit-scrollbar]:hidden">{children}</ul>;
}

const TONE = { great: "bg-teal-light text-teal-ink", good: "bg-teal-light text-teal-ink", fair: "bg-sky text-ink-muted", poor: "bg-clay-light text-clay-ink" } as const;
const ghost = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm font-semibold text-pine hover:border-teal";

export function PickCard({ pick, photo, month, tripId, saved, added, addIdea, regionName }: { pick: SeasonPick; photo?: Parameters<typeof PlacePhoto>[0]["photo"]; month: number; tripId: string | null; saved: Saved; added: Set<string>; addIdea: Props["addIdea"]; regionName: string | null }) {
  const { item, fit, researched, km } = pick;
  const glyph = plannerCategory(item.category);
  const isSaved = saved.isSaved(item.id);
  return (
    <li className="flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-3xl border border-line bg-white p-2 sm:w-auto">
      <div className="relative">
        <PlacePhoto photo={photo} name={item.name} credit sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 78vw" className="aspect-[16/10] w-full [&_img]:rounded-2xl [&>span]:rounded-2xl" fallback={<CategoryGlyph category={glyph} size={36} />} />
        <button type="button" aria-pressed={isSaved} onClick={() => void saved.toggle({ key: item.id, name: item.name, lat: item.lat, lng: item.lng, category: plannerCategory(item.category), region: regionName })} className="absolute right-2.5 top-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-pine shadow-card transition active:scale-90">
          <Glyph name="heart" size={20} className={isSaved ? "fill-clay text-clay" : ""} /><span className="sr-only">{isSaved ? "Saved" : "Save"} {item.name}</span>
        </button>
        <span className={`absolute left-2.5 top-2.5 max-w-[60%] truncate rounded-full px-2.5 py-1 text-xs font-semibold shadow-card ${researched ? "bg-pine text-white" : TONE[fit.verdict]}`}>{researched ? `Researched · best in ${MONTH_SHORT(month)}` : VERDICT_WORD[fit.verdict]}</span>
      </div>
      <div className="flex flex-1 flex-col px-3 pb-3 pt-3">
        <h3 className="break-words font-display text-xl font-semibold leading-snug text-pine">{item.name}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted"><CategoryGlyph category={glyph} size={15} className="shrink-0 text-teal" />{exploreCategoryLabel(item.category)}{km !== null && ` · ${km} km away`}</p>
        <p className="mt-2 text-sm text-ink">{fit.why}</p>
        {researched?.reason && <p className="mt-1 text-sm text-ink-muted">{researched.reason}{researched.source && <span className="block text-xs">Source: {researched.source}</span>}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {tripId && (added.has(item.id) ? <span className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-teal-ink"><Glyph name="check" size={16} />Added to Ideas</span> : <button type="button" onClick={() => void addIdea({ key: item.id, name: item.name, lat: item.lat, lng: item.lng, category: plannerCategory(item.category) })} className="inline-flex min-h-11 items-center justify-center rounded-full border border-pine bg-pine px-4 text-sm font-semibold text-white hover:opacity-90">Add to my ideas<span className="sr-only">: {item.name}</span></button>)}
          <a href={googleMapsPlace(item)} target="_blank" rel="noopener noreferrer" className={ghost}>Map<span className="sr-only"> of {item.name} (opens in a new tab)</span></a>
        </div>
      </div>
    </li>
  );
}
