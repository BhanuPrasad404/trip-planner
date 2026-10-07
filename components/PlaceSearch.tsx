"use client";

import { useId, useState } from "react";
import { distanceKm } from "@/lib/geo";
import { FAR_PIN_KM } from "@/lib/pin-check";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";

export type PickedPlace = { name: string; address: string; lat: number; lng: number };

type Props = {
  label: string;
  hint?: string;
  placeholder?: string;
  /** Bias results toward where the trip is going so "Fort" finds the local one. */
  near?: { lat: number; lng: number } | null;
  value: PickedPlace | null;
  onChange: (place: PickedPlace | null) => void;
  /** One-tap shortcuts that need no network (e.g. big cities). */
  quickPicks?: PickedPlace[];
};

// Search runs on an explicit button/Enter — NOT as-you-type — because the free geocoder forbids autocomplete.
export function PlaceSearch({ label, hint, placeholder, near, value, onChange, quickPicks = [] }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedPlace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (q.length < 2) {
      setError("Type at least 2 letters, then search.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, near: near ?? null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Search failed. Please try again.");
        setResults(null);
        return;
      }
      setResults(body.results ?? []);
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (value) {
    return (
      <div>
        <p className="block text-sm font-semibold text-ink">{label}</p>
        <div className="mt-1.5 flex items-start justify-between gap-3 rounded-xl border border-teal bg-teal-light/50 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="flex items-start gap-1.5 break-words text-base font-semibold"><Glyph name="pin" size={16} className="mt-1 text-teal" />{value.name}</p>
            {value.address && <p className="break-words text-sm text-ink-muted">{value.address}</p>}
            <p className="font-mono text-xs text-ink-muted">{value.lat.toFixed(4)}, {value.lng.toFixed(4)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setResults(null);
            }}
            className="min-h-10 shrink-0 px-2 text-sm font-semibold text-teal-ink underline underline-offset-2"
          >
            Change<span className="sr-only"> {label}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}</label>

      {quickPicks.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Quick picks for ${label}`}>
          {quickPicks.map((q) => (
            <button
              key={q.name}
              type="button"
              onClick={() => onChange(q)}
              className="min-h-9 rounded-full border border-line bg-white px-3 text-sm font-medium text-ink-muted hover:border-teal hover:text-teal-ink"
            >
              {q.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex gap-2">
        <input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // don't submit the surrounding form
              void search();
            }
          }}
          placeholder={placeholder ?? "Search a place, e.g. Kondapalli Fort"}
          autoComplete="off"
          maxLength={120}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="min-h-12 w-full min-w-0 rounded-xl border border-line bg-white px-3.5 py-2.5 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/40"
        />
        <Button variant="secondary" onClick={() => void search()} disabled={loading} className="shrink-0">
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1.5 text-sm font-medium text-clay-ink">{error}</p>}

      <div aria-live="polite">
        {results && results.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted">No matches. Try adding the town or state, e.g. “Kondapalli Fort, Andhra Pradesh”.</p>
        )}
        {results && results.length > 0 && (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(r);
                    setResults(null);
                    setQuery("");
                  }}
                  className="block min-h-12 w-full px-3.5 py-2.5 text-left hover:bg-teal-light/60"
                >
                  <span className="block break-words text-base font-semibold">{r.name}</span>
                  <span className="block break-words text-sm text-ink-muted">{r.address}</span>
                  <span className="block font-mono text-xs text-ink-muted">{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</span>
                  {near && (() => {
                    const km = distanceKm(near, r);
                    return km > FAR_PIN_KM ? (
                      <span className="mt-0.5 block text-xs font-semibold text-clay-ink"><Glyph name="warn" size={12} className="mr-1 inline align-text-bottom" />{Math.round(km)} km from your trip area</span>
                    ) : (
                      <span className="mt-0.5 block text-xs text-ink-muted">{km < 1 ? "<1" : Math.round(km)} km from your trip area</span>
                    );
                  })()}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
