// The My trips tabs change the list on the phone at once (no server round trip), and the address follows the tab.
import { createElement } from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/trips/TripsGrid", () => ({ TripsGrid: ({ trips }: { trips: { id: string; name: string }[] }) => createElement("ul", null, trips.map((t) => createElement("li", { key: t.id }, t.name))) }));
import { TripsBrowser as Browser } from "@/components/trips/TripsBrowser";
const TripsBrowser = Browser as unknown as (p: Record<string, unknown>) => React.ReactNode;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(text).join(" "));
const trips = [{ id: "a", name: "Goa", state: "active" }, { id: "b", name: "Manali", state: "upcoming" }, { id: "c", name: "Hampi", state: "completed" }] as never;

describe("My trips tabs", () => {
  it("are buttons that filter in place, update the address without adding history, and show the empty state for a tab with nothing", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", { history: { state: null, replaceState } });
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(TripsBrowser, { trips, userId: "u", initialTab: "all", failed: false }, createElement("p", null, "side"))); });
    expect(r.root.findAll((n) => n.type === "a")).toHaveLength(0);                       // not links: nothing is loaded again
    expect(text(r.root)).toContain("Goa"); expect(text(r.root)).toContain("Hampi"); expect(text(r.root)).toContain("side");
    const tab = (label: string) => r.root.findAll((n) => n.type === "button" && text(n).startsWith(label))[0];
    await act(async () => { tab("Upcoming").props.onClick(); });
    expect(text(r.root)).toContain("Manali"); expect(text(r.root)).not.toContain("Goa");
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/trips?tab=upcoming");
    await act(async () => { tab("Drafts").props.onClick(); });
    expect(text(r.root)).toContain("No draft trips");
    await act(async () => { tab("All").props.onClick(); });
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/trips");
    await act(async () => { r.unmount(); });
    vi.unstubAllGlobals();
  });
});
