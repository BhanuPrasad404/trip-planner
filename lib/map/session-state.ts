// One readable name for "what is the drive doing right now", derived from facts we already track. Not a second source of
// truth: nothing is stored here, so it can never disagree with the underlying hooks.
export type SessionState =
  | "not-started"
  | "locating" // asked for location, waiting for the first reading
  | "confirming" // got a position; the traveller must decide (early start / not at the planned start / rough position)
  | "waiting-for-precise-position"
  | "calculating" // getting the road route
  | "following" // navigating, camera follows you
  | "exploring" // navigating, the traveller is looking around the map; tracking continues in the background
  | "off-route"
  | "recalculating"
  | "arrived"
  | "error";

export type SessionFacts = {
  driveActive: boolean;
  hasFix: boolean;
  gateOpen: boolean;
  positionUsable: boolean;
  navPhase: "idle" | "loading" | "choosing" | "navigating" | "arrived" | "error";
  rerouting: boolean;
  offRouteSuspected: boolean;
  following: boolean;
};

export function deriveSessionState(f: SessionFacts): SessionState {
  if (!f.driveActive) return "not-started";
  if (!f.hasFix) return "locating";
  if (f.gateOpen) return "confirming";
  if (f.navPhase === "arrived") return "arrived";
  if (f.navPhase === "error") return "error";
  if (f.navPhase === "navigating") {
    if (f.rerouting) return "recalculating";
    if (f.offRouteSuspected) return "off-route";
    return f.following ? "following" : "exploring";
  }
  if (f.navPhase === "loading" || f.navPhase === "choosing") return "calculating";
  return f.positionUsable ? "calculating" : "waiting-for-precise-position";
}

export const SESSION_TEXT: Record<SessionState, string> = {
  "not-started": "",
  locating: "Finding your location…",
  confirming: "Confirm where you are starting from",
  "waiting-for-precise-position": "Waiting for a precise position…",
  calculating: "Finding the road route…",
  following: "",
  exploring: "Exploring the map — still tracking you",
  "off-route": "You left the route",
  recalculating: "Finding a new route…",
  arrived: "You have arrived",
  error: "Directions unavailable",
};
