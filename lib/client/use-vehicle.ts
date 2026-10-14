"use client";

import { useCallback, useMemo } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";
import { parseVehicle, vehicleKey, type Vehicle } from "@/lib/vehicle";

const EMPTY: { vehicle?: string } = {};

/**
 * What the traveller is driving. Kept on THIS phone: a trip can have a car and a motorcycle in it, and which one this person is in is
 * their own choice. (Sharing one vehicle for the whole group would need a column on the trip, which is a database change.)
 */
export function useVehicle(tripId: string): [Vehicle, (v: Vehicle) => void] {
  const [stored, setStored] = useLocalJson<{ vehicle?: string }>(vehicleKey(tripId), EMPTY);
  const vehicle = useMemo(() => parseVehicle(stored.vehicle), [stored]);
  const set = useCallback((v: Vehicle) => setStored({ vehicle: v }), [setStored]);
  return [vehicle, set];
}
