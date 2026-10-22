"use client";

// The ONE place picker for the start, the stops and the end (and fixing a stop's pin). No Search button:
//   • tap the box → "Use my current location" (where allowed), recent places, saved places and real suggestions, before typing
//   • type → India-only results after a short pause, with district and state so two places with the same name are told apart
//   • choose → the place, where it is, and a small map to check it
// On phones the open picker fills the screen (keyboard and list stay visible); on larger screens it is a dropdown under the box.
// Where the results come from is credited at the bottom (GeoNames, OpenStreetMap), as their licences ask.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { distanceKm } from "@/lib/geo";
import { FAR_PIN_KM } from "@/lib/pin-check";
import { accuracyOf, problemMessage, round3 } from "@/lib/location/start-location";
import { useCurrentPlace } from "@/lib/client/use-current-place";
import { usePlaceSearch } from "@/lib/client/use-place-search";
import { readRecent, rememberRecent, type RecentPlace } from "@/lib/client/recent-places";
import { CREDIT, KIND_LABEL, type PlaceHit, type PlaceKind } from "@/lib/places/types";
import type { SuggestGroup } from "@/lib/places/suggest";
import { Glyph } from "@/components/ui/Glyph";
import { Spinner } from "@/components/ui/Spinner";

const PlacePreviewMap = dynamic(() => import("./places/PlacePreviewMap"), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="tm-skeleton h-36 w-full rounded-xl" />,
});

export type PickedPlace = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** "gps" = the phone's own position ("Use my current location"). */
  origin?: "gps" | "search";
  accuracyM?: number | null;
};

type Props = {
  label: string;
  hint?: string;
  placeholder?: string;
  /** Bias results toward where the trip is going so "Fort" finds the local one. */
  near?: { lat: number; lng: number } | null;
  value: PickedPlace | null;
  onChange: (place: PickedPlace | null) => void;
  /** Extra one-tap places shown before typing (no network needed). */
  quickPicks?: PickedPlace[];
  /** Offer the phone's position: "offer" = a row to tap; "auto" = also fill it in at once when the site is already allowed. */
  currentLocation?: "off" | "offer" | "auto";
  /** Which recent-places list this box uses ("start", "places"…). */
  recentList?: string;
  /** Show the small map under the chosen place. */
  preview?: boolean;
};

type Row = { key: string; hit: PlaceHit; group?: string };
const kindText = (k: PlaceKind) => (k === "place" ? null : KIND_LABEL[k]);
const kmText = (km: number) => (km < 1 ? "under 1 km" : `${Math.round(km)} km`);

// Saved places and suggestions are fetched once per page and shared by every picker on it.
let savedOnce: Promise<PlaceHit[]> | null = null;
const suggestOnce = new Map<string, Promise<SuggestGroup[]>>();
export const clearPickerMemory = () => { savedOnce = null; suggestOnce.clear(); };

function loadSaved(): Promise<PlaceHit[]> {
  savedOnce ??= fetch("/api/saved-places")
    .then(async (r) => (r.ok ? ((await r.json()) as { places?: { place_key: string; name: string; lat: number; lng: number; category: string | null; region: string | null }[] }).places ?? [] : []))
    .then((rows) => rows.slice(0, 5).map((p) => ({ id: `saved:${p.place_key}`, name: p.name, lat: p.lat, lng: p.lng, kind: "place" as const, area: p.region ?? "", state: p.region, source: "trailmate" as const })))
    .catch(() => []);
  return savedOnce;
}
function loadSuggest(near: { lat: number; lng: number } | null): Promise<SuggestGroup[]> {
  const key = near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : "-";
  if (!suggestOnce.has(key)) {
    suggestOnce.set(key, fetch("/api/place-suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ near }) })
      .then(async (r) => (r.ok ? (((await r.json()) as { groups?: SuggestGroup[] }).groups ?? []) : []))
      .catch(() => { suggestOnce.delete(key); return []; }));
  }
  return suggestOnce.get(key)!;
}

export function PlaceSearch({ label, hint, placeholder, near = null, value, onChange, quickPicks = [], currentLocation = "off", recentList = "places", preview = true }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<RecentPlace[]>([]);
  const [saved, setSaved] = useState<PlaceHit[]>([]);
  const [groups, setGroups] = useState<SuggestGroup[] | null>(null);
  const touched = useRef(false);
  const wantGps = useRef(false);

  const gps = useCurrentPlace({ auto: currentLocation === "auto" && value === null, enabled: currentLocation !== "off" });
  const { place: here, online } = gps;
  const hereAt = here.status === "found" ? { lat: here.lat, lng: here.lng } : null;
  const bias = near ?? hereAt;
  const search = usePlaceSearch(query, bias, { enabled: open, online });

  // A position became available: fill the field when the traveller tapped for it, or (auto) when nothing was chosen or typed yet.
  useEffect(() => {
    if (here.status !== "found" || here.naming) return;
    const tapped = wantGps.current;
    const autoFill = currentLocation === "auto" && value === null && !touched.current;
    if (!tapped && !autoFill) return;
    wantGps.current = false;
    onChange({
      name: here.name ?? "My current location",
      address: here.name ? here.area : online ? "We couldn't name this area. The position is right; you can type a name instead." : "You're offline, so we can't name this area yet.",
      lat: round3(here.lat), lng: round3(here.lng), origin: "gps", accuracyM: here.accuracyM,
    });
    setOpen(false);
  }, [here, currentLocation, value, onChange, online]);

  const openPicker = useCallback(() => {
    setOpen(true);
    setRecent(readRecent(recentList));
    void loadSaved().then(setSaved);
    void loadSuggest(bias).then(setGroups);
  }, [recentList, bias]);

  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);

  // Desktop dropdown: a tap outside closes it. (On phones the picker covers the screen and has its own Cancel.)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) close(); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  const choose = useCallback((hit: PlaceHit) => {
    onChange({ name: hit.name, address: hit.area, lat: hit.lat, lng: hit.lng, origin: "search" });
    setRecent(rememberRecent({ name: hit.name, area: hit.area, lat: hit.lat, lng: hit.lng, kind: hit.kind }, recentList));
    setQuery("");
    close();
  }, [onChange, recentList, close]);

  const pickMyLocation = useCallback(() => {
    touched.current = true;
    wantGps.current = true;
    if (here.status === "found" && !here.naming) {
      // Already have it (e.g. it was auto-filled before "Change"): use it again without asking the phone.
      onChange({ name: here.name ?? "My current location", address: here.area, lat: round3(here.lat), lng: round3(here.lng), origin: "gps", accuracyM: here.accuracyM });
      wantGps.current = false;
      close();
      return;
    }
    gps.locate();
  }, [here, gps, onChange, close]);

  const typing = query.trim().length >= 2;
  const rows: Row[] = useMemo(() => {
    if (typing) return (search.results ?? []).map((hit) => ({ key: hit.id, hit }));
    const out: Row[] = [];
    const seen = new Set<string>();
    const add = (hit: PlaceHit, group: string) => {
      const k = `${hit.name.toLowerCase()}|${hit.lat.toFixed(2)},${hit.lng.toFixed(2)}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ key: `${group}:${hit.id}`, hit, group });
    };
    for (const r of recent) add({ id: `recent:${r.name}:${r.at}`, name: r.name, lat: r.lat, lng: r.lng, kind: r.kind ?? "place", area: r.area, state: null, source: "trailmate" }, "Recent");
    for (const s of saved) add(s, "Saved places");
    for (const q of quickPicks) add({ id: `quick:${q.name}`, name: q.name, lat: q.lat, lng: q.lng, kind: "city", area: q.address, state: null, source: "trailmate" }, "Quick picks");
    for (const g of groups ?? []) for (const p of g.places) add(p, g.title);
    return out;
  }, [typing, search.results, recent, saved, quickPicks, groups]);

  const showGpsRow = currentLocation !== "off";
  const optionCount = rows.length + (showGpsRow ? 1 : 0);
  const optionId = (i: number) => `${id}-opt-${i}`;
  const rowIndex = (i: number) => i + (showGpsRow ? 1 : 0);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openPicker();
      setActive((a) => (optionCount === 0 ? -1 : e.key === "ArrowDown" ? (a + 1) % optionCount : (a - 1 + optionCount) % optionCount));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault(); // never submit the surrounding form from the search box
      if (active < 0) return;
      if (showGpsRow && active === 0) pickMyLocation();
      else { const r = rows[active - (showGpsRow ? 1 : 0)]; if (r) choose(r.hit); }
    }
  }

  // ── chosen ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (value) {
    const acc = value.origin === "gps" ? accuracyOf(value.accuracyM) : null;
    const farKm = near && value.origin !== "gps" ? distanceKm(near, value) : null;
    return (
      <div>
        <p className="block text-sm font-semibold text-ink">{label}</p>
        <div className="mt-1.5 rounded-xl border border-teal bg-teal-light/50 px-3.5 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-start gap-1.5 break-words text-base font-semibold">
                <Glyph name={value.origin === "gps" ? "locate" : "pin"} size={16} className="mt-1 text-teal" />{value.name}
              </p>
              {value.address && <p className="break-words text-sm text-ink-muted">{value.address}</p>}
              {acc && <p className={`mt-0.5 text-xs ${acc.level === "rough" ? "font-semibold text-clay-ink" : "text-ink-muted"}`}>{acc.level === "rough" && <Glyph name="warn" size={12} className="mr-1 inline align-text-bottom" />}Your current location · {acc.text}</p>}
              {farKm !== null && farKm > FAR_PIN_KM && <p className="mt-0.5 text-xs font-semibold text-clay-ink"><Glyph name="warn" size={12} className="mr-1 inline align-text-bottom" />{Math.round(farKm)} km from your trip area: check it&apos;s the right one.</p>}
            </div>
            <button
              type="button"
              onClick={() => { touched.current = true; onChange(null); setQuery(""); queueMicrotask(() => inputRef.current?.focus()); }}
              className="min-h-10 shrink-0 px-2 text-sm font-semibold text-teal-ink underline underline-offset-2"
            >
              Change<span className="sr-only"> {label}</span>
            </button>
          </div>
          {preview && <div className="mt-2"><PlacePreviewMap lat={value.lat} lng={value.lng} label={value.name} accuracyM={value.origin === "gps" ? value.accuracyM ?? null : null} /></div>}
        </div>
      </div>
    );
  }

  // ── picking ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const problem = here.status === "problem" ? problemMessage(here.problem) : null;
  const gpsLine =
    here.status === "locating" ? (here.slow ? "Still finding you… indoors this can take up to 20 seconds." : "Finding you…")
      : here.status === "found" ? (here.naming ? "Found you. Naming the area…" : here.name ? `${here.name} · ${accuracyOf(here.accuracyM).text}` : accuracyOf(here.accuracyM).text)
        : problem ? "Tap to try again" : "Fills in where you are now";
  const listId = `${id}-list`;
  const status = search.status;

  return (
    <div ref={boxRef} className={open ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--background)] px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:relative sm:inset-auto sm:z-auto sm:block sm:overflow-visible sm:bg-transparent sm:p-0" : "relative"}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}</label>
        {open && <button type="button" onClick={close} className="min-h-10 px-2 text-sm font-semibold text-teal-ink underline underline-offset-2 sm:hidden">Cancel</button>}
      </div>

      <div className="relative mt-1.5">
        <Glyph name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef}
          id={id}
          value={query}
          onChange={(e) => { touched.current = true; setQuery(e.target.value); setActive(-1); if (!open) openPicker(); }}
          onFocus={() => { if (!open) openPicker(); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Search a town, area or place in India"}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={120}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="min-h-12 w-full min-w-0 rounded-xl border border-line bg-white py-2.5 pl-10 pr-10 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/40"
        />
        {query && (
          <button type="button" aria-label="Clear the search" onClick={() => { setQuery(""); inputRef.current?.focus(); }} className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted hover:bg-sky">
            <Glyph name="close" size={16} />
          </button>
        )}
      </div>
      {hint && !open && <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-muted">{hint}</p>}

      {!open && showGpsRow && (here.status === "locating" || problem) && (
        <p role="status" className="mt-1.5 text-sm text-ink-muted">{problem ? <span className="font-semibold text-clay-ink">{problem.title}. </span> : null}{gpsLine}</p>
      )}

      {open && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-lg sm:absolute sm:inset-x-0 sm:top-full sm:z-40 sm:max-h-[26rem]">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul id={listId} role="listbox" aria-label={`${label}: choices`} className="divide-y divide-line">
              {showGpsRow && (
                <li
                  id={optionId(0)} role="option" aria-selected={active === 0}
                  onClick={pickMyLocation}
                  className={`flex min-h-14 cursor-pointer items-center gap-3 px-3.5 py-2.5 ${active === 0 ? "bg-teal-light/70" : "hover:bg-teal-light/50"}`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-light text-teal-ink">
                    {here.status === "locating" || (here.status === "found" && here.naming) ? <Spinner /> : <Glyph name="locate" size={18} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-teal-ink">Use my current location</span>
                    <span className="block text-sm text-ink-muted">{gpsLine}</span>
                  </span>
                </li>
              )}
              {rows.map((r, i) => {
                const idx = rowIndex(i);
                const prevGroup = i > 0 ? rows[i - 1].group : undefined;
                const km = bias ? distanceKm(bias, r.hit) : null;
                const far = near && km !== null && km > FAR_PIN_KM;
                const kind = kindText(r.hit.kind);
                return (
                  <li key={r.key} id={optionId(idx)} role="option" aria-selected={active === idx} onClick={() => choose(r.hit)}
                    className={`cursor-pointer px-3.5 py-2.5 ${active === idx ? "bg-teal-light/70" : "hover:bg-teal-light/50"}`}>
                    {r.group && r.group !== prevGroup && (
                      <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
                        <Glyph name={r.group === "Recent" ? "recent" : r.group === "Saved places" ? "star" : "pin"} size={12} />{r.group}
                      </span>
                    )}
                    <span className="block break-words text-base font-semibold">{r.hit.name}</span>
                    <span className="block break-words text-sm text-ink-muted">{[kind, r.hit.area].filter(Boolean).join(" · ") || "India"}</span>
                    {km !== null && (
                      <span className={`mt-0.5 block text-xs ${far ? "font-semibold text-clay-ink" : "text-ink-muted"}`}>
                        {far && <Glyph name="warn" size={12} className="mr-1 inline align-text-bottom" />}{kmText(km)} {near ? "from your trip area" : "from you"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {problem && (
              <div role="alert" className="border-t border-line bg-clay-light/50 px-3.5 py-3 text-sm">
                <p className="font-semibold text-clay-ink">{problem.title}</p>
                <ul className="mt-1 space-y-1 text-ink-muted">{problem.detail.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
            )}

            <div aria-live="polite" className="px-3.5 py-2.5 text-sm text-ink-muted">
              {!online && <p className="font-medium text-clay-ink">You&apos;re offline. Searching needs the internet; your recent places still work.</p>}
              {online && typing && search.waiting && <p className="flex items-center gap-2"><Spinner /> Searching…</p>}
              {online && typing && search.map === "loading" && !search.waiting && <p className="flex items-center gap-2"><Spinner /> Checking the map for more…</p>}
              {online && typing && status === "busy" && <p>The map search is busy right now, so only towns and areas from our own list are shown. Try again in a moment.</p>}
              {online && typing && status === "limit" && <p>Today&apos;s map-search limit is used up, so only towns and areas from our own list are shown. It resets within 24 hours.</p>}
              {online && typing && status === "unavailable" && <p>Our place list didn&apos;t load. Try again in a moment.</p>}
              {online && typing && search.error && <p className="font-medium text-clay-ink">{search.error}</p>}
              {online && typing && search.results && search.results.length === 0 && search.map !== "loading" && (
                <p>No place in India matches “{query.trim()}”. Check the spelling, or add the district, e.g. “Kondapalli, NTR”.</p>
              )}
              {online && query.trim().length === 1 && <p>Keep typing…</p>}
              {online && typing && query.trim().length >= 3 && search.more !== "done" && search.map !== "loading" && !search.waiting && (
                <button type="button" onClick={search.searchMore} disabled={search.more === "loading"} className="mt-1 inline-flex min-h-10 items-center gap-2 font-semibold text-teal-ink underline underline-offset-2">
                  {search.more === "loading" ? <><Spinner /> Searching more…</> : "Not here? Search more"}
                </button>
              )}
              {!typing && online && groups === null && <p className="flex items-center gap-2"><Spinner /> Loading suggestions…</p>}
            </div>
          </div>
          <p className="border-t border-line px-3.5 py-2 text-[11px] leading-snug text-ink-muted">
            <a href={CREDIT.geonames.href} target="_blank" rel="noopener noreferrer" className="underline">{CREDIT.geonames.text}</a>
            {" · "}
            <a href={CREDIT.osm.href} target="_blank" rel="noopener noreferrer" className="underline">{CREDIT.osm.text}</a>
          </p>
        </div>
      )}
    </div>
  );
}
