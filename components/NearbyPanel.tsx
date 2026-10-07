"use client";

import { useEffect, useRef, useState } from "react";
import { distanceKm, isAhead } from "@/lib/geo";
import { NEARBY_KINDS, NEARBY_KIND_IDS, type NearbyKind, type NearbyPlace } from "@/lib/nearby";
import { formatKm } from "@/lib/format";
import { KindBadge, KindGlyph } from "@/components/ui/Glyph";

type NearbyPanelProps = {
  /** The place to search around when the device location isn't used (e.g. the next stop). */
  anchor: { lat: number; lng: number; label: string } | null;
};

type Origin = { lat: number; lng: number; label: string };
type Result = { kind: NearbyKind; origin: Origin; heading: number | null; places: NearbyPlace[]; at: number; stale: boolean };

// While following, re-search only after moving this far AND at least this long since the last search.
const FOLLOW_MOVE_KM = 2;
const FOLLOW_MIN_SECONDS = 45;

const getPosition = () =>
  new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 }
    );
  });

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

function Thumb({ place }: { place: NearbyPlace }) {
  if (!place.photo) {
    return (
      <KindBadge kind={place.kind} size={64} />
    );
  }
  return (
    <div className="shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- real photo from Supabase Storage / Wikimedia; sized and lazy-loaded */}
      <img src={place.photo.url} alt={`Photo of ${place.name}`} width={64} height={64} loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 rounded-xl object-cover" />
    </div>
  );
}

export function NearbyPanel({ anchor }: NearbyPanelProps) {
  const [kind, setKind] = useState<NearbyKind | null>(null);
  const [useMe, setUseMe] = useState(true);
  const [follow, setFollow] = useState(false);
  const [onlyAhead, setOnlyAhead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Latest values for the long-lived location watcher (kept in refs so the watcher never goes stale).
  const kindRef = useRef<NearbyKind | null>(null);
  const busyRef = useRef(false);
  const lastSearch = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const searchRef = useRef<(k: NearbyKind, o?: Origin, heading?: number | null, me?: boolean) => Promise<void>>(async () => {});

  async function search(k: NearbyKind, forced?: Origin, heading: number | null = null, me: boolean = useMe) {
    if (busyRef.current) return;
    busyRef.current = true;
    setKind(k);
    setError(null);
    setBusy(true);
    try {
      let origin: Origin | null = forced ?? null;
      if (!origin && me) {
        const pos = await getPosition();
        if (pos) origin = { ...pos, label: "your location" };
        else if (!anchor) throw new Error("Couldn't get your location. Allow location access in your browser, then try again.");
        else setError(`Couldn't get your location, so showing places near ${anchor.label} instead.`);
      }
      origin ??= anchor;
      if (!origin) throw new Error("Add a stop first, or allow your location.");

      const res = await fetch("/api/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: k, lat: origin.lat, lng: origin.lng, radius_km: k === "fuel" || k === "hospital" || k === "sights" ? 15 : 5 }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't search nearby.");
      const now = Date.now();
      lastSearch.current = { lat: origin.lat, lng: origin.lng, at: now };
      setResult({ kind: k, origin, heading, places: body.places as NearbyPlace[], at: now, stale: body.stale === true });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Couldn't search nearby.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    kindRef.current = kind;
    searchRef.current = search;
  });

  // Follow mode: watch the device position and quietly refresh the list as the traveler moves.
  useEffect(() => {
    if (!follow) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const heading = pos.coords.heading != null && (pos.coords.speed ?? 0) > 1.5 ? pos.coords.heading : null; // only trust heading while moving
        const k = kindRef.current;
        if (!k) return;
        const last = lastSearch.current;
        const moved = !last || distanceKm(last, here) >= FOLLOW_MOVE_KM;
        const waited = !last || Date.now() - last.at >= FOLLOW_MIN_SECONDS * 1000;
        if (moved && waited) void searchRef.current(k, { ...here, label: "your location" }, heading);
        else setResult((r) => (r && heading !== null ? { ...r, heading, origin: { ...here, label: "your location" } } : r));
      },
      (err) => {
        setError(err.code === 1 ? "Location permission was denied, so live follow can't work. Allow it in your browser settings." : "Couldn't read your location right now.");
        setFollow(false);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [follow]);

  function toggleFollow() {
    const next = !follow;
    setFollow(next);
    setError(null);
    if (next) {
      lastSearch.current = null; // search again on the first fix
      if (!kind) void search("fuel"); // sensible default while driving; the watcher keeps it fresh
      else void search(kind);
    }
  }

  const places = (result?.places ?? [])
    .map((p) => ({ p, ahead: result ? isAhead(result.origin, result.heading, p) : false }))
    .filter((x) => !onlyAhead || x.ahead);

  return (
    <section aria-labelledby="nearby-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="nearby-heading" className="font-display text-lg font-semibold text-pine">Nearby</h2>
      <p className="mt-1 text-sm text-ink-muted">Real places from OpenStreetMap, with photos where real ones exist.</p>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="What are you looking for?">
        {NEARBY_KIND_IDS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            aria-pressed={kind === k}
            onClick={() => search(k, follow && result ? { ...result.origin } : undefined, result?.heading ?? null)}
            className={`min-h-9 rounded-full border px-3 text-sm font-semibold disabled:opacity-60 ${kind === k ? "border-teal bg-teal-light text-teal-ink" : "border-line bg-white text-ink-muted hover:border-teal"}`}
          >
            <KindGlyph kind={k} size={16} className="mr-1.5 inline align-text-bottom" />{NEARBY_KINDS[k].label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          role="switch"
          aria-checked={follow}
          onClick={toggleFollow}
          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 font-semibold ${follow ? "border-teal bg-teal-light text-teal-ink" : "border-line bg-white text-ink-muted hover:border-teal"}`}
        >
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${follow ? "animate-pulse bg-teal" : "bg-line"}`} />
          {follow ? "Following you" : "Follow my location"}
        </button>
        {!follow && (
          <span className="inline-flex items-center gap-4" role="radiogroup" aria-label="Search around">
            <label className="inline-flex min-h-9 items-center gap-2">
              <input type="radio" name="nearby-origin" checked={useMe} onChange={() => { setUseMe(true); if (kind) void search(kind, undefined, null, true); }} /> My location
            </label>
            <label className="inline-flex min-h-9 items-center gap-2">
              <input type="radio" name="nearby-origin" checked={!useMe} disabled={!anchor} onChange={() => { setUseMe(false); if (kind) void search(kind, undefined, null, false); }} />
              {anchor ? `Near ${anchor.label}` : "Near a stop"}
            </label>
          </span>
        )}
      </div>
      {follow && (
        <p className="mt-2 text-xs text-ink-muted">
          The list refreshes as you travel (about every {FOLLOW_MOVE_KM} km). Your position is used only for each search and is never saved. Works best on your phone while moving.
        </p>
      )}
      {result?.heading != null && (
        <label className="mt-2 inline-flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyAhead} onChange={(e) => setOnlyAhead(e.target.checked)} /> Only show places ahead of me
        </label>
      )}

      <div aria-live="polite" className="mt-3">
        {busy && <p className="text-sm text-ink-muted">Searching…</p>}
        {error && (
          <p role="alert" className="text-sm font-semibold text-clay-ink">
            {error}
            {kind && !busy && (
              <button type="button" onClick={() => void search(kind, follow && result ? { ...result.origin } : undefined, result?.heading ?? null)} className="ml-2 underline underline-offset-2">
                Try again
              </button>
            )}
          </p>
        )}
        {!busy && result?.stale && (
          <p role="status" className="mb-1 text-xs font-semibold text-clay-ink">The live map data is busy, so these are saved results from earlier. Tap a category to refresh.</p>
        )}
        {!busy && result && (
          <p className="mb-1 text-xs text-ink-muted">
            {follow ? "Live · " : ""}Updated {clockTime(result.at)} · near {result.origin.label}
          </p>
        )}
        {!busy && result && places.length === 0 && (
          <p className="text-sm text-ink-muted">
            {onlyAhead ? "Nothing found ahead of you yet. Untick the filter to see everything nearby." : "Nothing found within the search radius. OpenStreetMap may be thin here — try a bigger town nearby."}
          </p>
        )}
        {!busy && places.length > 0 && (
          <ul className="divide-y divide-line">
            {places.map(({ p, ahead }) => (
              <li key={p.id} className="flex gap-3 py-3 text-sm">
                <Thumb place={p} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-words font-semibold">{p.name}</p>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 font-semibold text-teal-ink underline underline-offset-2"
                    >
                      Open map<span className="sr-only"> for {p.name} (opens in a new tab)</span>
                    </a>
                  </div>
                  <p className="text-ink-muted">
                    {formatKm(distanceKm(result!.origin, p))} km{ahead && <span className="ml-2 rounded-full bg-teal-light px-2 py-0.5 text-xs font-semibold text-teal-ink">Ahead</span>}
                  </p>
                  {p.hours && <p className="break-words text-xs text-ink-muted">Hours (as listed): {p.hours}</p>}
                  {p.photo && (
                    <p className="text-xs text-ink-muted">
                      {p.photo.source === "community" ? "Photo by a Trailmate traveler" : p.photo.creditUrl ? (
                        <>Photo: <a href={p.photo.creditUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Wikimedia Commons<span className="sr-only"> (opens in a new tab)</span></a></>
                      ) : "Photo"}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
