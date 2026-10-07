"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Live group updates: when anyone in the trip adds/edits a place or votes, re-run `onChange`.
 * Realtime respects Row Level Security, so only trip members receive these events.
 * Caveat: Supabase can't filter DELETE events by trip, so a removal made by someone else shows up
 * on the next refresh/focus rather than instantly.
 */
export function useTripRealtime(tripId: string, userId: string, onChange: () => void, onRemoteAdd?: (name: string) => void) {
  const changeRef = useRef(onChange);
  const addRef = useRef(onRemoteAdd);
  useEffect(() => {
    changeRef.current = onChange;
    addRef.current = onRemoteAdd;
  });

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return; // missing env etc. — the page still works without live updates
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => changeRef.current(), 700); // coalesce bursts (e.g. a bulk import)
    };

    const channel = supabase
      .channel(`trip-${tripId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "places", filter: `trip_id=eq.${tripId}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          const row = payload.new as { added_by?: string | null; name?: string };
          if (row.added_by && row.added_by !== userId) addRef.current?.(row.name ?? "a place");
        }
        schedule();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "place_votes", filter: `trip_id=eq.${tripId}` }, schedule)
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [tripId, userId]);
}
