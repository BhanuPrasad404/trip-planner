"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type LiveMember = {
  user_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_kmh: number | null;
  updated_at: string;
};

const COLUMNS = "user_id, lat, lng, heading, speed_kmh, updated_at";

/**
 * Everyone in the trip who is currently sharing their live location, kept up to date in real time.
 * Only members of the trip can see these rows (enforced by the database, not by this code).
 * Rows are small and change often, so this keeps them in local state and does NOT refresh the whole page.
 */
export function useLiveMembers(tripId: string): Record<string, LiveMember> {
  const [members, setMembers] = useState<Record<string, LiveMember>>({});

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return; // no env — the rest of the page still works
    }
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase.from("live_locations").select(COLUMNS).eq("trip_id", tripId);
      if (cancelled) return;
      if (error) {
        console.error("[live] could not load live locations:", error.message); // e.g. migration not applied yet
        return;
      }
      setMembers(Object.fromEntries((data as LiveMember[]).map((m) => [m.user_id, m])));
    };
    void load();

    const channel = supabase
      .channel(`live-${tripId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_locations", filter: `trip_id=eq.${tripId}` }, (p) => {
        const row = p.new as LiveMember;
        setMembers((m) => ({ ...m, [row.user_id]: row }));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_locations", filter: `trip_id=eq.${tripId}` }, (p) => {
        const row = p.new as LiveMember;
        setMembers((m) => ({ ...m, [row.user_id]: row }));
      })
      // Supabase cannot filter DELETE events, so we check the trip ourselves.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "live_locations" }, (p) => {
        const old = p.old as { user_id?: string; trip_id?: string };
        if (!old.user_id || (old.trip_id && old.trip_id !== tripId)) return;
        setMembers((m) => {
          const { [old.user_id as string]: _gone, ...rest } = m;
          void _gone;
          return rest;
        });
      })
      .subscribe();

    // Coming back to the tab: re-sync in case we missed events while it was asleep.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  return members;
}
