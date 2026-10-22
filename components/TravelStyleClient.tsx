"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useMemo, useSyncExternalStore } from "react";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { learnFromTrips, type LearnTrip } from "@/lib/learning";
import { TravelStyle } from "./TravelStyle";

const subscribe = () => () => {};
/** India time (+5:30), whatever the phone's own time zone: the plan's times are India time. */
const browserOffset = () => INDIA_UTC_OFFSET_MIN;

/** Computed in the browser so "first stop at 10:30" uses the traveller's REAL timezone, not a guess. */
export function TravelStyleClient({ trips, compact }: { trips: LearnTrip[]; compact?: boolean }) {
  const offset = useSyncExternalStore(subscribe, browserOffset, () => null);
  const learning = useMemo(() => (offset === null ? null : learnFromTrips(trips, offset)), [trips, offset]);
  if (!learning) return <Skeleton className="h-40 rounded-2xl" />;
  return <TravelStyle learning={learning} compact={compact} />;
}
