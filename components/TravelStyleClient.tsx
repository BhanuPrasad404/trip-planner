"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useMemo, useSyncExternalStore } from "react";
import { learnFromTrips, type LearnTrip } from "@/lib/learning";
import { TravelStyle } from "./TravelStyle";

const subscribe = () => () => {};
const browserOffset = () => -new Date().getTimezoneOffset();

/** Computed in the browser so "first stop at 10:30" uses the traveller's REAL timezone, not a guess. */
export function TravelStyleClient({ trips, compact }: { trips: LearnTrip[]; compact?: boolean }) {
  const offset = useSyncExternalStore(subscribe, browserOffset, () => null);
  const learning = useMemo(() => (offset === null ? null : learnFromTrips(trips, offset)), [trips, offset]);
  if (!learning) return <Skeleton className="h-40 rounded-2xl" />;
  return <TravelStyle learning={learning} compact={compact} />;
}
