import { describe, expect, it } from "vitest";
import { shouldTrackNavigation, type ClickFacts } from "@/lib/client/route-progress";

const click = (o: Partial<ClickFacts> = {}): ClickFacts => ({ href: "https://trailmate.app/trips/1/live", current: "https://trailmate.app/dashboard", target: null, download: false, noProgress: false, button: 0, modifier: false, defaultPrevented: false, ...o });

describe("route progress: which clicks show the 'loading the next page' bar", () => {
  it("a normal in-app link to another page does", () => {
    expect(shouldTrackNavigation(click())).toBe(true);
    expect(shouldTrackNavigation(click({ href: "https://trailmate.app/trips?tab=completed", current: "https://trailmate.app/trips" }))).toBe(true); // a filter change is a real load
  });
  it("the page you are already on, or only a #anchor jump, does not (it would never end)", () => {
    expect(shouldTrackNavigation(click({ href: "https://trailmate.app/dashboard", current: "https://trailmate.app/dashboard" }))).toBe(false);
    expect(shouldTrackNavigation(click({ href: "https://trailmate.app/dashboard#main", current: "https://trailmate.app/dashboard" }))).toBe(false);
  });
  it("new tabs, downloads, modified clicks, right-clicks and prevented clicks do not", () => {
    expect(shouldTrackNavigation(click({ target: "_blank" }))).toBe(false);
    expect(shouldTrackNavigation(click({ download: true }))).toBe(false);
    expect(shouldTrackNavigation(click({ modifier: true }))).toBe(false);
    expect(shouldTrackNavigation(click({ button: 2 }))).toBe(false);
    expect(shouldTrackNavigation(click({ defaultPrevented: true }))).toBe(false);
    expect(shouldTrackNavigation(click({ noProgress: true }))).toBe(false);
  });
  it("other sites and non-web links do not", () => {
    expect(shouldTrackNavigation(click({ href: "https://www.google.com/maps/dir/?api=1" }))).toBe(false);
    expect(shouldTrackNavigation(click({ href: "mailto:hi@example.com" }))).toBe(false);
    expect(shouldTrackNavigation(click({ href: "not a url" }))).toBe(false);
  });
  it("target=_self still counts", () => {
    expect(shouldTrackNavigation(click({ target: "_self" }))).toBe(true);
  });
});
