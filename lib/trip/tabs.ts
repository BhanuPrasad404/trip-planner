// The filter tabs of "My trips". Plain data (no "use client"), so the server page and the client list can both read it.
import type { TripState } from "@/lib/trip-state";

export type TripsTab = "all" | TripState;
export const TRIP_TABS: { id: TripsTab; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "upcoming", label: "Upcoming" }, { id: "draft", label: "Drafts" }, { id: "completed", label: "Completed" },
];
