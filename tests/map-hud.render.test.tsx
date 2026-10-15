import { createElement, act } from "react";
import type React from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HudNotices } from "@/components/map/HudNotices";
import { RouteInfoButton, RouteInfoSheet, routeInfoLabel } from "@/components/map/RouteInfo";
import type { TollView } from "@/lib/client/use-toll-watch";
import type { ActiveAlert } from "@/lib/client/use-alerts";
import type { HudNotice } from "@/lib/map/notices";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/** Render inside act (React 19 defers rendering outside it). */
const render = (el: React.ReactElement) => { let r!: TestRenderer.ReactTestRenderer; act(() => { r = TestRenderer.create(el); }); return r; };
const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(text).join(""));
const toll = (aheadM: number | null, extra: object = {}) => ({ id: "node/1", lat: 0, lng: 0, name: "Kothur Toll Plaza", ref: "NH44", operator: null, fee: null, routeM: 1, offsetM: 1, aheadM, ...extra }) as TollView["ahead"][number];
const view = (o: Partial<TollView> = {}): TollView => ({ navigating: true, status: "ready", complete: true, unavailable: false, ahead: [], next: null, retry: () => {}, ...o });
const alertOf = (o: Partial<ActiveAlert> = {}): ActiveAlert => ({ id: "toll:1", kind: "toll", level: 2, title: "Toll plaza ahead", body: "About 4.8 km ahead.", at: Date.UTC(2026, 9, 15, 4, 0), ...o });

describe("routeInfoLabel: a button only when there is something to show", () => {
  it("is absent when navigating a route with nothing to say", () => expect(routeInfoLabel(view(), 0, 0)).toBeNull());
  it("is absent when not navigating", () => expect(routeInfoLabel(view({ navigating: false, status: "idle" }), 0, 0)).toBeNull());
  it("names the toll with the measured distance when a plaza is close", () => expect(routeInfoLabel(view({ next: { ...toll(4_800), aheadM: 4_800 } as never, ahead: [toll(4_800)] }), 0, 0)).toBe("Toll · 4.8 km"));
  it("shows plain distance for a close plaza in metres", () => expect(routeInfoLabel(view({ next: { ...toll(800), aheadM: 800 } as never }), 0, 0)).toBe("Toll · 800 m"));
  it("a far plaza is listed behind a quiet 'Tolls ahead', not announced", () => expect(routeInfoLabel(view({ ahead: [toll(90_000)] }), 0, 0)).toBe("Tolls ahead"));
  it("alerts that did not fit on the map are counted", () => expect(routeInfoLabel(view(), 2, 0)).toBe("Alerts · 2"));
  it("when the toll check failed for good, a button exists so the traveller can see (not a card on the map)", () => expect(routeInfoLabel(view({ status: "error", unavailable: true }), 0, 0)).toBe("Route info"));
  it("messages moved off the map stay reachable", () => expect(routeInfoLabel(view(), 0, 3)).toBe("Messages"));
});

describe("RouteInfoSheet", () => {
  let r: TestRenderer.ReactTestRenderer; let keys: ((e: { key: string }) => void)[]; let focused: number;
  beforeEach(() => { keys = []; focused = 0; vi.stubGlobal("document", { addEventListener: (_: string, h: (e: { key: string }) => void) => { keys.push(h); }, removeEventListener: (_: string, h: (e: { key: string }) => void) => { keys = keys.filter((k) => k !== h); } }); });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });
  const mount = async (props: { tolls?: TollView; alerts?: ActiveAlert[]; other?: HudNotice[]; onClose?: () => void } = {}) => {
    await act(async () => { r = TestRenderer.create(createElement(RouteInfoSheet, { tolls: props.tolls ?? view(), alerts: props.alerts ?? [], other: props.other ?? [], onClose: props.onClose ?? (() => {}) }), { createNodeMock: () => ({ focus: () => { focused++; } }) }); });
  };
  const all = () => JSON.stringify(r.toJSON());

  it("lists the plaza with its real distance and says no fee is listed, never inventing one", async () => {
    await mount({ tolls: view({ ahead: [toll(4_700)] }) });
    const t = all(); expect(t).toContain("Kothur Toll Plaza"); expect(t).toContain("about 4.7 km ahead"); expect(t).toContain("No fee listed in the map data"); expect(t).not.toMatch(/₹|Rs \d/);
  });
  it("shows the fee only when the map has one, exactly as written", async () => {
    await mount({ tolls: view({ ahead: [toll(4_700, { fee: "Rs 105" })] }) }); expect(all()).toContain("Fee in map data: Rs 105");
  });
  it("says 'in map data' when nothing was found, and never that the road is toll-free", async () => {
    await mount({ tolls: view({ status: "ready" }) });
    const t = all(); expect(t).toContain("No toll plazas found ahead on this route in map data."); expect(t).not.toMatch(/toll-free|free of tolls|there are no tolls/i);
  });
  it("when the check failed for good it says tolls may exist, and offers to check again", async () => {
    const retry = vi.fn();
    await mount({ tolls: view({ status: "error", unavailable: true, retry }) });
    expect(all()).toContain("there may be tolls ahead that aren"); // "aren't shown"
    const btn = r.root.findAll((x) => x.type === "button" && text(x).includes("Check again"))[0];
    act(() => btn.props.onClick()); expect(retry).toHaveBeenCalledTimes(1);
  });
  it("while it is still trying quietly it says so plainly, without alarm", async () => {
    await mount({ tolls: view({ status: "loading" }) }); expect(all()).toContain("Checking this route for toll plazas");
    await act(async () => { r.update(createElement(RouteInfoSheet, { tolls: view({ status: "error", unavailable: false }), alerts: [], other: [], onClose: () => {} })); });
    expect(all()).toContain("we'll keep trying quietly");
  });
  it("lists recent alerts (including ones already dismissed from the map) and messages that did not fit", async () => {
    await mount({ alerts: [alertOf(), alertOf({ id: "arrival:2", title: "You've arrived", body: "Open Trailmate.", at: Date.UTC(2026, 9, 15, 5, 0) })], other: [{ id: "share", severity: "info", text: "Your live location isn't reaching the group.", dismissible: true }] });
    const t = all(); expect(t).toContain("Toll plaza ahead"); expect(t).toContain("You've arrived"); expect(t).toContain("Your live location isn't reaching the group."); expect(t).toContain("Other messages");
  });
  it("is honest about having no alerts yet", async () => { await mount(); expect(all()).toContain("None yet on this trip."); });
  it("is a labelled dialog, focuses its close button, and closes with the button or Escape", async () => {
    const onClose = vi.fn(); await mount({ onClose });
    expect(r.root.findAll((x) => x.props.role === "dialog" && x.props["aria-label"] === "Route info")).toHaveLength(1);
    expect(focused).toBe(1);
    act(() => r.root.findAll((x) => x.type === "button" && x.props["aria-label"] === "Close route info")[0].props.onClick()); expect(onClose).toHaveBeenCalledTimes(1);
    act(() => keys.forEach((k) => k({ key: "Enter" }))); expect(onClose).toHaveBeenCalledTimes(1);
    act(() => keys.forEach((k) => k({ key: "Escape" }))); expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("never covers the driving controls: it is capped in height and scrolls inside itself", async () => {
    await mount(); expect(all()).toMatch(/max-h-\[42dvh\]/); expect(all()).toContain("overflow-y-auto");
  });
  it("does not show the toll section at all when not navigating", async () => { await mount({ tolls: view({ navigating: false, status: "idle" }) }); expect(all()).not.toContain("Tolls ahead"); });
});

describe("RouteInfoButton", () => {
  it("is a tappable 44 px button that says whether it is open, and flags a warning without relying on colour alone", () => {
    const r = render(createElement(RouteInfoButton, { label: "Toll · 4.8 km", open: true, warn: true, onClick: () => {} }));
    const b = r.root.findByType("button"); expect(b.props["aria-expanded"]).toBe(true); expect(b.props.className).toContain("min-h-11");
    expect(text(b)).toContain("Toll · 4.8 km"); expect(text(b)).toContain("(needs attention)"); // the dot is not the only signal
    expect(r.root.findAll((x) => x.type === "span" && String(x.props.className).includes("bg-clay"))).toHaveLength(1);
    const calm = render(createElement(RouteInfoButton, { label: "Toll · 4.8 km", open: false, warn: false, onClick: () => {} }));
    expect(text(calm.root)).not.toContain("needs attention");
  });
});

describe("HudNotices", () => {
  const notice = (o: Partial<HudNotice> = {}): HudNotice => ({ id: "a", severity: "info", text: "Hello", dismissible: true, ...o });
  it("renders nothing for nothing", () => expect(render(createElement(HudNotices, { shown: [], hiddenCount: 0, onDismiss: () => {} })).toJSON()).toBeNull());
  it("critical is an assertive alert, the rest are polite status messages", () => {
    const r = render(createElement(HudNotices, { shown: [notice({ id: "c", severity: "critical", text: "Brake" }), notice({ id: "i", text: "Fyi" })], hiddenCount: 0, onDismiss: () => {} }));
    expect(r.root.findAll((x) => x.type === "p").map((p) => p.props.role)).toEqual(["alert", "status"]);
  });
  it("a dismissible message has a labelled 44 px dismiss; a non-dismissible one has none", () => {
    const onDismiss = vi.fn();
    const r = render(createElement(HudNotices, { shown: [notice({ id: "x", text: "Weak signal" }), notice({ id: "y", text: "Paused", dismissible: false, severity: "important" })], hiddenCount: 0, onDismiss }));
    const btns = r.root.findAll((x) => x.type === "button");
    expect(btns).toHaveLength(1); expect(btns[0].props["aria-label"]).toBe("Dismiss: Weak signal"); expect(btns[0].props.className).toContain("h-11");
    act(() => btns[0].props.onClick()); expect(onDismiss).toHaveBeenCalledWith("x");
  });
  it("shows an action when the message has one, and counts what is waiting", () => {
    const onAction = vi.fn(), onMore = vi.fn();
    const r = render(createElement(HudNotices, { shown: [notice({ action: { id: "retry", label: "Retry" } })], hiddenCount: 2, onDismiss: () => {}, onAction, onMore }));
    act(() => r.root.findAll((x) => x.type === "button" && text(x) === "Retry")[0].props.onClick()); expect(onAction).toHaveBeenCalledWith("a", "retry");
    const more = r.root.findAll((x) => x.type === "button" && text(x).includes("2 more messages"))[0]; act(() => more.props.onClick()); expect(onMore).toHaveBeenCalled();
  });
  it("says '1 more message' in the singular", () => {
    const r = render(createElement(HudNotices, { shown: [], hiddenCount: 1, onDismiss: () => {}, onMore: () => {} }));
    expect(text(r.root)).toBe("1 more message");
  });
});
