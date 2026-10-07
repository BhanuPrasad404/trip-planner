"use client";

import { useCallback, useState } from "react";
import type { NavMapProps } from "@/components/TripMap";
import type { NavUi } from "@/components/map/NavigationOverlay";
import type { useTripLive } from "@/lib/client/use-trip-live";
import { deriveSessionState } from "@/lib/map/session-state";

type Live = ReturnType<typeof useTripLive>;

/** Everything the Map and Live pages share about navigation: the overlay's data and the props the map needs. */
export function useNavUi(live: Live, follow: boolean, setFollow: (v: boolean) => void, onArrivedDone?: (id: string, name: string) => void) {
  const { drive, navigation, gate } = live;
  const [headingUp, setHeadingUp] = useState(true);
  const [view, setView] = useState<{ kind: "overview"; n: number } | null>(null);
  const [recenter, setRecenter] = useState<{ n: number } | null>(null);

  const session = deriveSessionState({
    driveActive: drive.active,
    hasFix: !!drive.me,
    gateOpen: gate.open,
    positionUsable: live.liveOk,
    navPhase: navigation.phase,
    rerouting: navigation.rerouting,
    offRouteSuspected: navigation.offRouteSuspected,
    following: follow,
  });

  const onOverview = useCallback(() => { setFollow(false); setView((v) => ({ kind: "overview", n: (v?.n ?? 0) + 1 })); }, [setFollow]);
  const t = navigation.target;
  const ui: NavUi = {
    nav: navigation, session, follow, headingUp, journey: live.journey, startedFrom: live.startedFrom, manualPlace: drive.manualPlace, speedKmh: drive.me?.speedKmh ?? null, nowMs: drive.me?.at ?? 0,
    signal: drive.quality && drive.me ? { grade: drive.quality.grade, message: drive.quality.message } : null,
    // Re-centre is a COMMAND: resume following AND glide to the current position, every time (even if you have not moved).
    onRecenter: () => { setFollow(true); setRecenter((r) => ({ n: (r?.n ?? 0) + 1 })); },
    onOverview,
    onToggleHeading: () => setHeadingUp((v) => !v),
    onArrivedDone: t && onArrivedDone ? () => onArrivedDone(t.id, t.name) : undefined,
  };
  const nav: NavMapProps = {
    phase: navigation.phase, routes: navigation.routes, selectedId: navigation.selectedId, choices: navigation.choices,
    progress: navigation.progress, puck: navigation.puck, speedKmh: drive.me?.speedKmh ?? null,
    alternatives: navigation.alternatives, altChoices: navigation.altChoices,
    target: t ? { lat: t.lat, lng: t.lng, name: t.name } : null,
  };
  const navBusy = ["loading", "choosing", "navigating", "arrived"].includes(navigation.phase);
  return { ui, nav, headingUp, viewRequest: view, recenter, onCompass: ui.onToggleHeading, navBusy, session };
}
