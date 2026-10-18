// The map shows the NEXT stop only (name, time, distance along the blue line), like Google Maps. The end of the day is one small
// secondary line. Everything follows the live position and changes the moment the next stop changes.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavigationBanner, NavigationPanel, restOfDayText, type NavUi } from "@/components/map/NavigationOverlay";
import { useNavUi } from "@/lib/client/use-nav-ui";
import type { Navigation } from "@/lib/client/use-navigation";
import type { Journey } from "@/lib/map/journey";
import type { Remaining } from "@/lib/trip/remaining";

const T0 = 1_800_000_000_000;
const noop = vi.fn();
const progress = (remainingM: number, remainingS: number) => ({ alongM: 0, offsetM: 0, snapped: { lat: 0, lng: 0 }, routeBearing: 0, remainingM, remainingS, etaMs: T0 + remainingS * 1000, step: {}, nextStep: null, distanceToManeuverM: 300, arrived: false });
const nav = (over: Partial<Navigation> = {}): Navigation => ({
  phase: "navigating", routes: [], choices: [], selectedId: null, banner: null, puck: null, rerouting: false, offRouteSuspected: false, uncertain: false, notice: null, error: null, notes: [], alternatives: [], altChoices: [], altLoading: false, altFrom: null,
  progress: progress(12_400, 18 * 60), target: { id: "s1", name: "Bhongir Fort", lat: 17.5, lng: 78.9, kind: "stop" }, voice: true, armed: true,
  arm: noop, routeOptions: noop, closeOptions: noop, choose: noop, begin: noop, stop: noop, retry: noop, toggleVoice: noop, dismissNotice: noop,
  ...over,
} as unknown as Navigation);
const journey = (o: Partial<Journey> = {}): Journey => ({ name: "Warangal", remainingKm: 146.2, remainingMin: 310, etaMs: T0 + 310 * 60_000, stops: 3, kmLabel: "146 km", ...o });
const ui = (n: Navigation, over: Partial<NavUi> = {}): NavUi => ({ nav: n, session: "following", follow: true, headingUp: true, journey: null, startedFrom: null, manualPlace: null, speedKmh: null, nowMs: T0, signal: null, onRecenter: noop, onOverview: noop, onToggleHeading: noop, ...over });
const big = (h: string) => /text-2xl[^>]*>([^<]+)</.exec(h)?.[1];

describe("the map's numbers are the next stop's", () => {
  it("name, time and distance of the next stop are the big, always-visible numbers, even with more stops after it", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav(), { journey: journey() })} />);
    expect(h).toContain("Next stop"); expect(h).toContain("Bhongir Fort");
    expect(big(h)).toBe("18 min"); // the next stop's time, not 5 h 10 min for the whole day
    expect(h).toContain("12.4 km · arrive about");
    expect(h).not.toMatch(/text-xl[^>]*>Warangal</); // the end of the day is not the headline
  });
  it("the rest of the day is ONE small secondary line: distance, where it ends, how many stops, and that stays are included", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav(), { journey: journey() })} />);
    expect(h).toMatch(/data-testid="rest-of-day" class="[^"]*text-\[11px\][^"]*">Rest of day: 146 km to Warangal · 3 stops · done about [^<]+\(with stops\)</);
  });
  it("one stop left: no rest-of-day line (it would repeat the big numbers)", () => {
    expect(renderToStaticMarkup(<NavigationPanel ui={ui(nav(), { journey: null })} />)).not.toContain("Rest of day");
  });
  it("the next-stop line is no longer hidden behind the details toggle (it was folded on the map)", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav(), { journey: journey() })} />);
    expect(h).toContain('aria-expanded="false"'); expect(h).toContain("12.4 km");
  });
  it("the trip's destination as the next target says Destination", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ target: { id: "__destination__", name: "Warangal", lat: 0, lng: 0, kind: "destination" } }))} />);
    expect(h).toContain(">Destination<"); expect(h).toContain("Warangal");
  });
  it("when the road route stops short of the end of the day (8-stop limit) it is NOT called the rest of the day", () => {
    const t = restOfDayText(journey({ stops: 8, coversAll: false, name: "Stop 8" }), T0);
    expect(t).toMatch(/^Next 8 stops: 146 km to Stop 8 · there about .+ \(with stops\) · more after$/); expect(t).not.toContain("Rest of day");
  });
  it("singular wording: 1 stop", () => { expect(restOfDayText(journey({ stops: 1 }), T0)).toContain("· 1 stop ·"); });
  it("a label from the shared answer ('about 146 km', '(estimated)') is used as is", () => {
    expect(restOfDayText(journey({ kmLabel: "about 146 km" }), T0)).toContain("Rest of day: about 146 km to Warangal");
    expect(restOfDayText(journey({ kmLabel: undefined, remainingKm: 146.2 }), T0)).toContain("146 km");
  });
});

describe("it updates live", () => {
  it("every GPS reading moves the numbers (they come from the progress along the line)", () => {
    const a = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ progress: progress(12_400, 1080) } as never))} />);
    const b = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ progress: progress(3_050, 300) } as never))} />);
    expect(big(a)).toBe("18 min"); expect(big(b)).toBe("5 min"); expect(b).toContain("3.1 km");
  });
  it("marking the stop done switches the headline to the NEW next stop, and the day line shrinks", () => {
    const after = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ target: { id: "s2", name: "Kolanupaka Temple", lat: 0, lng: 0, kind: "stop" }, progress: progress(21_000, 1500) } as never), { journey: journey({ stops: 2, remainingKm: 133.8, kmLabel: "134 km" }) })} />);
    expect(after).toContain("Kolanupaka Temple"); expect(after).not.toContain("Bhongir Fort"); expect(after).toContain("21 km");
    expect(after).toContain("Rest of day: 134 km to Warangal · 2 stops");
  });
  it("while the road route to the new next stop loads, the last known distance is shown and labelled as updating", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ phase: "loading", progress: null }), { nextLeft: { name: "Bhongir Fort", km: 12, minutes: 18, kmText: "12 km", destination: false } })} />);
    expect(h).toContain("Finding the road route"); expect(h).toContain("last known 12 km, updating");
  });
  it("a number for a different stop is never shown as this one's", () => {
    const h = renderToStaticMarkup(<NavigationPanel ui={ui(nav({ phase: "loading", progress: null }), { nextLeft: { name: "Somewhere Else", km: 40, minutes: 50, kmText: "40 km", destination: false } })} />);
    expect(h).not.toContain("last known");
  });
});

describe("driving without turn-by-turn", () => {
  const left = { name: "Bhongir Fort", km: 12.4, minutes: 18, kmText: "12.4 km", destination: false };
  it("the map's top stack still says the next stop, its distance and time", () => {
    const h = renderToStaticMarkup(<NavigationBanner ui={ui(nav({ phase: "idle", progress: null }), { idleNext: true, nextLeft: left })} />);
    expect(h).toContain('data-testid="idle-next"'); expect(h).toContain("Next stop"); expect(h).toContain("Bhongir Fort"); expect(h).toContain("12.4 km · 18 min");
  });
  it("not while turn-by-turn is running (the panel has it), and not over 'Arriving in …'", () => {
    expect(renderToStaticMarkup(<NavigationBanner ui={ui(nav(), { idleNext: false, nextLeft: left })} />)).not.toContain("idle-next");
    expect(renderToStaticMarkup(<NavigationBanner ui={ui(nav({ phase: "idle" }), { idleNext: true, nextLeft: left, approach: { name: "Bhongir Fort", distanceM: 90, area: false } })} />)).not.toContain("idle-next");
  });
});

describe("useNavUi wires the shared distance answer to the right stop only", () => {
  const remaining = (nextId: string, nextName: string): Remaining => ({
    next: { id: nextId, name: nextName, km: 12.4, minutes: 18 }, stops: [], legs: [], totalKm: 12.4, totalMin: 18, covers: 1, coversAll: true, lastName: nextName,
    basis: "road", gps: "good", exact: true, note: null,
  });
  const liveOf = (o: { phase?: string; nextId?: string; active?: boolean; liveOk?: boolean }) => ({
    drive: { active: o.active ?? true, me: null, quality: null, manualPlace: null },
    navigation: { ...nav({ phase: (o.phase ?? "idle") as never }), target: { id: "s1", name: "Bhongir Fort", lat: 0, lng: 0, kind: "stop" } },
    gate: { open: false, tripId: "t1" }, liveOk: o.liveOk ?? true, journey: null, startedFrom: null, vehicle: "car",
    arrival: { approach: null, prompt: null },
    distanceLeft: remaining(o.nextId ?? "s1", o.nextId === "s2" ? "Other" : "Bhongir Fort"),
  });
  const run = (live: ReturnType<typeof liveOf>) => {
    let out: ReturnType<typeof useNavUi> | null = null;
    const P = () => { out = useNavUi(live as never, true, () => {}); return null; };
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(createElement(P)); });
    act(() => r.unmount());
    return out!.ui;
  };
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  it("next-stop numbers come through when they are about the stop navigation heads for", () => {
    expect(run(liveOf({})).nextLeft).toMatchObject({ name: "Bhongir Fort", kmText: "12 km" }) // the shared label rounds 10 km+ to whole km;
  });
  it("…and are dropped when they are about another stop (e.g. a route measured before a stop changed)", () => {
    expect(run(liveOf({ nextId: "s2" })).nextLeft).toBeNull();
  });
  it("the idle chip only while driving, with a usable position, and no turn-by-turn", () => {
    expect(run(liveOf({})).idleNext).toBe(true);
    expect(run(liveOf({ phase: "navigating" })).idleNext).toBe(false);
    expect(run(liveOf({ active: false })).idleNext).toBe(false);
    expect(run(liveOf({ liveOk: false })).idleNext).toBe(false);
  });
});
