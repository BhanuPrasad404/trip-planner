// The compact mobile navigation panel: the map stays the main thing, the always-needed controls are always there, the rest folds away.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavigationBanner, NavigationPanel, type NavUi } from "@/components/map/NavigationOverlay";
import type { Navigation } from "@/lib/client/use-navigation";

const noop = vi.fn();
const nav = (over: Partial<Navigation> = {}): Navigation => ({
  forTargetId: null, phase: "navigating", routes: [], choices: [], selectedId: null, banner: null, puck: null, rerouting: false, offRouteSuspected: false, uncertain: false, notice: null, error: null, notes: [], alternatives: [], altChoices: [], altLoading: false, altFrom: null,
  progress: { alongM: 0, offsetM: 0, snapped: { lat: 0, lng: 0 }, routeBearing: 0, remainingM: 42_000, remainingS: 3_000, etaMs: 1_800_000_000_000 + 3_000_000, step: {}, nextStep: null, distanceToManeuverM: 500, arrived: false },
  target: { id: "s1", name: "Warangal Fort", lat: 17.9, lng: 79.6, kind: "stop" }, voice: true, armed: true,
  arm: noop, routeOptions: noop, closeOptions: noop, choose: noop, begin: noop, stop: noop, retry: noop, toggleVoice: noop, dismissNotice: noop,
  ...over,
} as unknown as Navigation);
const ui = (n: Navigation, over: Partial<NavUi> = {}): NavUi => ({ nav: n, session: "following", follow: true, headingUp: true, journey: null, startedFrom: null, manualPlace: null, speedKmh: null, nowMs: 1_800_000_000_000, signal: null, onRecenter: noop, onOverview: noop, onToggleHeading: noop, ...over });

describe("compact navigation panel (the map stays visible)", () => {
  it("on the map it starts folded: destination, time left, distance, End and a toggle — not the full list of options", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav())} />);
    expect(h).toContain("Warangal Fort");
    expect(h).toContain("42 km");
    expect(h).toContain(">End<");
    expect(h).toContain('aria-expanded="false"');
    expect(h).not.toContain("Overview");
    expect(h).not.toContain("Other routes");
    expect(h).not.toContain("Heading up");
  });
  it("the panel can never cover more than 60% of the map and respects the phone's bottom safe area", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav())} />);
    expect(h).toContain("max-h-[60%]");
    expect(h).toContain("env(safe-area-inset-bottom)");
  });
  it("in the page (not floating over a map) the details start open", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav())} floating={false} />);
    expect(h).toContain("Overview");
    expect(h).toContain("Other routes");
  });
  it("Re-centre appears only when the map is not following you", () => {
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(nav(), { follow: true })} />)).not.toContain("Re-centre");
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(nav(), { follow: false })} />)).toContain("Re-centre");
  });
  it("the trip destination is labelled as such, and arriving there says Finish (it is not a stop to mark done)", () => {
    const dest = nav({ target: { id: "__destination__", name: "Visakhapatnam", lat: 17.7, lng: 83.2, kind: "destination" } });
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(dest)} />)).toContain("Destination");
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(nav({ ...dest, phase: "arrived" }))} />)).toContain("Finish");
  });
  it("loading is announced with Cancel; a failure shows the message, a retry and a way out — never an empty map", () => {
    const loading = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ phase: "loading" }))} />);
    expect(loading).toContain("Finding the road route");
    expect(loading).toContain("Cancel");
    const failed = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ phase: "error", error: "Road directions are unavailable right now." }))} />);
    expect(failed).toContain("Road directions are unavailable right now.");
    expect(failed).toContain("Try again");
    expect(failed).toContain("Stop navigation");
  });
  it("the turn banner is compact on phones (smaller icon and text) and clears the notch", () => {
    const n = nav({ banner: { arrow: "right", distanceText: "500 m", instruction: "Turn right onto NH65", spoken: "", announceKey: null } as never });
    const h = renderToStaticMarkup(<NavigationBanner ui={ui(n)} />);
    expect(h).toContain("Turn right onto NH65");
    expect(h).toContain("h-11 w-11");
    expect(h).toContain("env(safe-area-inset-top");
  });
});
