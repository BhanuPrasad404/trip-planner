import type { ComponentType } from "react";
import { IconDashboard, IconDiscover, IconExplore, IconLive, IconMap, IconMemories, IconPlan, IconProfile, IconTrips } from "./icons";

export type NavTrip = { id: string; name: string; state: "draft" | "upcoming" | "active" | "completed" };
export type NavItem = { id: string; label: string; href: string; Icon: ComponentType<{ className?: string }>; match: (path: string) => boolean };

/** The trip the person is "in": the one in the URL, else the one happening now, else the most recent. */
export function currentTrip(pathname: string, trips: NavTrip[]): NavTrip | null {
  const m = /^\/trips\/([0-9a-fA-F-]{36})/.exec(pathname);
  if (m) return trips.find((t) => t.id === m[1]) ?? null;
  return trips.find((t) => t.state === "active") ?? trips.find((t) => t.state === "upcoming") ?? trips[0] ?? null;
}

export function buildNav(pathname: string, trips: NavTrip[]): NavItem[] {
  const trip = currentTrip(pathname, trips);
  const t = (sub: string) => (trip ? `/trips/${trip.id}${sub}` : "/trips");
  const inTrip = (sub: string) => (p: string) => new RegExp(`^/trips/[^/]+${sub}(/|$)`).test(p);
  return [
    { id: "dashboard", label: "Dashboard", href: "/dashboard", Icon: IconDashboard, match: (p) => p === "/dashboard" },
    { id: "discover", label: "Discover", href: "/discover", Icon: IconDiscover, match: (p) => p === "/discover" },
    { id: "trips", label: "My trips", href: "/trips", Icon: IconTrips, match: (p) => p === "/trips" || /^\/trips\/[^/]+$/.test(p) },
    { id: "plan", label: "Plan", href: t("/plan"), Icon: IconPlan, match: inTrip("/plan") },
    { id: "explore", label: "Explore", href: "/explore", Icon: IconExplore, match: (p) => p === "/explore" || inTrip("/explore")(p) },
    { id: "live", label: "Live trip", href: t("/live"), Icon: IconLive, match: inTrip("/live") },
    { id: "map", label: "Map", href: t("/map"), Icon: IconMap, match: inTrip("/map") },
    { id: "memories", label: "Memories", href: "/memories", Icon: IconMemories, match: (p) => p === "/memories" || inTrip("/memories")(p) },
    { id: "profile", label: "Profile", href: "/profile", Icon: IconProfile, match: (p) => p === "/profile" },
  ];
}
