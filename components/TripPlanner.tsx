"use client";

import { useMemo, useState } from "react";
import { Trip, TripMember, Place } from "@/lib/types";
import { RouteThread } from "./RouteThread";
import { StopCard } from "./StopCard";
import { AddPlaceForm } from "./AddPlaceForm";

// Supabase returns the joined season_tags relation nested — extend the base type for this view
type PlaceWithSeason = Place & {
  season_tags?: { good_months: number[]; reason: string | null } | null;
};

type TripPlannerProps = {
  trip: Trip;
  initialPlaces: PlaceWithSeason[];
  members: TripMember[];
};

export function TripPlanner({ trip, initialPlaces, members }: TripPlannerProps) {
  const [activeDay, setActiveDay] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [places, setPlaces] = useState(initialPlaces);

  const dayPlaces = useMemo(
    () => places.filter((p) => p.day_number === activeDay),
    [places, activeDay]
  );

  async function refreshPlaces() {
    // Simple refetch — swap for Supabase Realtime subscription once group sync matters
    const res = await fetch(`/api/places?tripId=${trip.id}`);
    const data = await res.json();
    setPlaces(data);
    setShowAddForm(false);
  }

  return (
    <div className="min-h-screen flex justify-center bg-sky py-6 px-3">
      <div className="w-full max-w-[420px] bg-white rounded-[28px] overflow-hidden shadow-2xl shadow-pine/20">
        {/* HEADER */}
        <div className="bg-pine text-white px-5 pt-5 pb-4">
          <div className="text-[10.5px] tracking-widest uppercase text-white/55 font-semibold mb-1.5">
            Trailmate &middot; Group Trip
          </div>
          <h1 className="font-display text-2xl font-semibold leading-tight">{trip.name}</h1>
          <div className="flex gap-3 mt-2.5 font-mono text-[11.5px] text-white/75">
            <span>{trip.num_days} DAYS</span>
            <span>&middot;</span>
            <span>{members.length} TRAVELERS</span>
          </div>
          {members.length > 0 && (
            <div className="flex mt-3.5">
              {members.map((m, i) => (
                <div
                  key={m.id}
                  className="w-[26px] h-[26px] rounded-full border-2 border-pine flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: m.avatar_color, marginLeft: i === 0 ? 0 : -8 }}
                >
                  {m.display_name?.[0]?.toUpperCase() ?? "?"}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ROUTE THREAD */}
        <RouteThread
          numDays={trip.num_days}
          activeDay={activeDay}
          onSelectDay={setActiveDay}
          startDate={trip.start_date}
        />

        {/* LIST */}
        <div className="px-4.5 pt-4 pb-2">
          <div className="flex justify-between items-baseline mb-3">
            <h2 className="font-display text-[17px] font-semibold">Day {activeDay}</h2>
            <span className="font-mono text-[11px] text-ink-soft">
              {dayPlaces.length} STOP{dayPlaces.length !== 1 ? "S" : ""}
            </span>
          </div>

          {dayPlaces.length === 0 && (
            <p className="text-[13px] text-ink-soft py-6 text-center">
              No stops yet for Day {activeDay}. Add the first one below.
            </p>
          )}

          {dayPlaces.map((place) => (
            <StopCard
              key={place.id}
              place={place}
              goodMonths={place.season_tags?.good_months}
              seasonReason={place.season_tags?.reason}
            />
          ))}
        </div>

        {/* ADD PLACE */}
        <div className="px-4.5 pb-5">
          {showAddForm ? (
            <AddPlaceForm tripId={trip.id} dayNumber={activeDay} onAdded={refreshPlaces} />
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-3 rounded-xl bg-marigold text-pine font-bold text-sm"
            >
              + Add a stop to Day {activeDay}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
