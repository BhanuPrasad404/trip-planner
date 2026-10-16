"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { STOPS_CHANGED, stopsChannel } from "./stop-signal";
import { stopsSignature, type StopRow } from "@/lib/trip/stop-change";

export const DRIVE_CHECK_MS = 120_000;

/**
 * Keeps an open trip screen's stops up to date with changes made ELSEWHERE (another member, or me on another device), including
 * deleted stops. `onChange` reloads the page's data (router.refresh).
 *
 *   • at once: the "stops changed" hint (stop-signal.ts) and, when `listenToRows`, Realtime insert/update events for this trip;
 *   • when the app comes back (screen on, back online): one light check;
 *   • while DRIVING only: the same light check every 2 minutes, in case Realtime is down.
 * The light check reads 4 small columns of this trip's stops (no photos, no season data) and reloads only when they differ.
 * Being offline or a failed check never reloads and never pretends something changed.
 */
export function useTripChanges({ tripId, places, driving, onChange, listenToRows = true }: {
  tripId: string;
  /** The stops as the SERVER last sent them (not including answers still waiting to be sent). */
  places: readonly StopRow[];
  driving: boolean;
  onChange: () => void;
  listenToRows?: boolean;
}) {
  const changeRef = useRef(onChange);
  const sigRef = useRef(stopsSignature(places));
  useEffect(() => {
    changeRef.current = onChange;
    sigRef.current = stopsSignature(places);
  });

  const checkRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    let sb: ReturnType<typeof createClient>;
    try {
      sb = createClient();
    } catch {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!disposed) changeRef.current(); }, 600); // a re-plan changes many rows at once: one reload
    };
    let checking = false;
    checkRef.current = async () => {
      if (disposed || checking) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      checking = true;
      try {
        const { data, error } = await sb.from("places").select("id, status, day_number, sequence_order").eq("trip_id", tripId).limit(1000);
        if (!disposed && !error && data && stopsSignature(data as StopRow[]) !== sigRef.current) changeRef.current();
      } catch {
        // offline / server trouble: try again next time
      } finally {
        checking = false;
      }
    };

    let channel = sb.channel(stopsChannel(tripId)).on("broadcast", { event: STOPS_CHANGED }, schedule);
    if (listenToRows) {
      channel = channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "places", filter: `trip_id=eq.${tripId}` }, schedule)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "places", filter: `trip_id=eq.${tripId}` }, schedule);
    }
    channel.subscribe();

    const onBack = () => { if (document.visibilityState === "visible") void checkRef.current(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("online", onBack);
      void sb.removeChannel(channel);
    };
  }, [tripId, listenToRows]);

  useEffect(() => {
    if (!driving) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void checkRef.current(); }, DRIVE_CHECK_MS);
    return () => clearInterval(t);
  }, [driving]);
}
