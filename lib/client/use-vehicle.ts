"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";
import { legacyVehicleKey, parseVehicle, vehicleKey, type Vehicle } from "@/lib/vehicle";

const EMPTY: { vehicle?: string } = {};

/**
 * What the traveller is driving. Kept on THIS phone: a trip can have a car and a motorcycle in it, and which one this person is in is
 * their own choice. (Sharing one vehicle for the whole group would need a column on the trip, which is a database change.)
 */
export function useVehicle(tripId: string, userId: string): [Vehicle, (v: Vehicle) => void] {
  const [stored, setStored] = useLocalJson<{ vehicle?: string }>(vehicleKey(userId, tripId), EMPTY);
  // A choice saved before it was per person: move it once (it was this phone's, so it most likely was this person's).
  useEffect(() => {
    try {
      const old = window.localStorage.getItem(legacyVehicleKey(tripId));
      if (old === null) return;
      window.localStorage.removeItem(legacyVehicleKey(tripId));
      if (window.localStorage.getItem(vehicleKey(userId, tripId)) === null) setStored(JSON.parse(old) as { vehicle?: string });
    } catch { /* blocked or damaged: keep the default */ }
  }, [tripId, userId, setStored]);
  const vehicle = useMemo(() => parseVehicle(stored.vehicle), [stored]);
  const set = useCallback((v: Vehicle) => setStored({ vehicle: v }), [setStored]);
  return [vehicle, set];
}
