"use client";

// The filter tabs and the list of trips on "My trips". The tabs change what is shown on the phone at once: they used to be links, and every
// tap asked the server to load the whole page again (trips, summaries, photos). The address still follows the tab (so a refresh or a shared
// link opens the same tab) but the browser's own history is only replaced, never filled with one entry per tap.
import { useState, type ReactNode } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { TripsGrid } from "@/components/trips/TripsGrid";
import type { TripSummary } from "@/lib/server/trip-summaries";
import type { TripState } from "@/lib/trip-state";

export type TripsTab = "all" | TripState;
export const TRIP_TABS: { id: TripsTab; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "upcoming", label: "Upcoming" }, { id: "draft", label: "Drafts" }, { id: "completed", label: "Completed" },
];

export function TripsBrowser({ trips, userId, initialTab, failed, children }: { trips: TripSummary[]; userId: string; initialTab: TripsTab; failed: boolean; /** The column beside the list (plan card, new-trip form). */ children: ReactNode }) {
  const [tab, setTab] = useState<TripsTab>(initialTab);
  const count = (id: TripsTab) => (id === "all" ? trips.length : trips.filter((t) => t.state === id).length);
  const shown = tab === "all" ? trips : trips.filter((t) => t.state === tab);

  function choose(id: TripsTab) {
    setTab(id);
    try { window.history.replaceState(window.history.state, "", id === "all" ? "/trips" : `/trips?tab=${id}`); } catch { /* the tab still changes */ }
  }

  return (
    <>
      <nav aria-label="Filter trips" className="relative -mx-4 mt-6 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-2">
          {TRIP_TABS.map((t) => {
            const on = tab === t.id;
            const n = count(t.id);
            return (
              <button key={t.id} type="button" onClick={() => choose(t.id)} aria-current={on ? "page" : undefined} aria-pressed={on} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-95 ${on ? "bg-pine text-[var(--tm-on-accent)] shadow-card" : "bg-white text-ink-muted ring-1 ring-line hover:text-pine hover:ring-teal"}`}>
                {t.label}<span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-bold tabular-nums ${on ? "bg-marigold text-ink" : n === 0 ? "bg-sky text-ink-muted/60" : "bg-sky text-ink"}`}>{n}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section aria-label="Trips">
          {failed && <p role="alert" className="rounded-xl border border-clay/30 bg-clay-light px-4 py-3 text-sm font-medium text-clay-ink">We couldn&apos;t load your trips. Please refresh the page.</p>}
          {!failed && shown.length === 0 ? (
            <div className="rounded-[1.75rem] border-2 border-dashed border-teal/40 bg-white/70 p-8 text-center">
              <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-light text-teal-ink"><Glyph name="compass" size={24} /></span>
              <p className="mt-3 font-display text-xl font-semibold text-pine">{trips.length === 0 ? "No trips yet" : `No ${tab} trips`}</p>
              <p className="mt-2 text-base text-ink-muted">{trips.length === 0 ? "Create your first trip with the form — or open an invite link a friend shared with you." : "Try another filter above."}</p>
            </div>
          ) : (
            <TripsGrid trips={shown} userId={userId} />
          )}
        </section>
        <div className="space-y-4">{children}</div>
      </div>
    </>
  );
}
