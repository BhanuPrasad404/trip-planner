import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import { Spinner, LoadingMark } from "@/components/ui/Spinner";
import { AppLoader } from "@/components/ui/AppLoader";
import { readFileSync } from "node:fs";
import { CardGridSkeleton, FeedSkeleton, MapSkeleton, Skeleton } from "@/components/ui/Skeleton";
import RootLoading from "@/app/loading";
import AppLoading from "@/app/(app)/loading";
import TripLoading from "@/app/(app)/trips/[id]/loading";
import MapLoading from "@/app/(app)/trips/[id]/map/loading";
import LiveLoading from "@/app/(app)/trips/[id]/live/loading";
import DiscoverLoading from "@/app/(app)/discover/loading";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Button loading state", () => {
  it("not loading: exactly as before (label, enabled, no spinner, no aria-busy)", () => {
    const h = html(<Button>Save</Button>);
    expect(h).toContain("Save");
    expect(h).not.toContain("aria-busy");
    expect(h).not.toContain("animate-spin");
    expect(h).not.toMatch(/ disabled=""/); // the attribute (the CSS class names also contain the word)
  });
  it("loading: spinner at once, disabled, announced as busy, and the label can change to what is happening", () => {
    const h = html(<Button loading loadingLabel="Saving…">Save</Button>);
    expect(h).toContain("animate-spin");
    expect(h).toContain('aria-busy="true"');
    expect(h).toMatch(/ disabled=""/);
    expect(h).toContain("Saving…");
    expect(h).not.toContain(">Save<");
  });
  it("loading without a loadingLabel keeps the normal label next to the spinner (the button does not change size or meaning)", () => {
    const h = html(<Button loading>Share</Button>);
    expect(h).toContain("Share");
    expect(h).toContain("animate-spin");
  });
  it("a click while loading never reaches the handler (no double submit)", () => {
    const onClick = vi.fn(); const preventDefault = vi.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(createElement(Button, { loading: true, onClick }, "Share")); });
    const btn = r.root.findByType("button");
    btn.props.onClick({ preventDefault });
    expect(onClick).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
    act(() => r.unmount());
  });
  it("not loading: the click goes through", () => {
    const onClick = vi.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(createElement(Button, { onClick }, "Share")); });
    r.root.findByType("button").props.onClick({});
    expect(onClick).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });
  it("an explicitly disabled button stays disabled when not loading", () => {
    expect(html(<Button disabled>Go</Button>)).toMatch(/ disabled=""/);
  });
});

describe("loading indicators respect reduced motion and are announced once", () => {
  it("the spinner stops spinning for people who prefer reduced motion and can carry an accessible label", () => {
    const h = html(<Spinner label="Saving" />);
    expect(h).toContain("motion-reduce:animate-none");
    expect(h).toContain('role="status"');
    expect(h).toContain("Saving");
  });
  it("a spinner without a label is decoration (nothing announced twice)", () => {
    expect(html(<Spinner />)).not.toContain("role=");
  });
  it("the branded mark uses the logo's colours and the animated classes that are switched off for reduced motion", () => {
    const h = html(<LoadingMark label="Loading Trailmate" />);
    expect(h).toContain("#E8A33D");
    expect(h).toContain("tm-mark-trail");
    expect(h).toContain("Loading Trailmate");
  });
  it("skeletons are decorative (hidden from screen readers)", () => {
    for (const el of [<Skeleton key="a" />, <CardGridSkeleton key="b" />, <MapSkeleton key="c" />, <FeedSkeleton key="d" />]) expect(html(el)).toContain('aria-hidden="true"');
  });
});

describe("every route has an instant loading screen with exactly one announcement", () => {
  const pages: [string, () => React.ReactElement][] = [
    ["root", () => <RootLoading />], ["app", () => <AppLoading />], ["trip", () => <TripLoading />],
    ["map", () => <MapLoading />], ["live", () => <LiveLoading />], ["discover", () => <DiscoverLoading />],
  ];
  for (const [name, el] of pages) {
    it(`${name}: busy, announced once, shaped like the page (skeletons or the brand mark)`, () => {
      const h = html(el());
      expect(h).toContain('aria-busy="true"');
      expect((h.match(/role="status"/g) ?? []).length).toBe(1);
      expect(h).toMatch(/tm-skeleton|tm-mark-trail|tm-roadload/);
    });
  }
});

describe("the opening screen (AppLoader)", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../components/ui/AppLoader.tsx", import.meta.url), "utf8");
  it("is announced once, with a label, and the drawing is hidden from screen readers", () => {
    const h = html(<AppLoader label="Loading Trailmate" />);
    expect((h.match(/role="status"/g) ?? []).length).toBe(1);
    expect(h).toContain("Loading Trailmate"); expect(h).toContain('aria-hidden="true"');
  });
  it("uses only theme colours (no fixed colour values), so each theme can repaint it", () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const t of ["sky-top", "sky-bottom", "sun", "hill-far", "hill-near", "road", "line", "ring", "shadow"]) {
      expect((css.match(new RegExp(`--tm-load-${t}:`, "g")) ?? []).length, t).toBe(2); // the light theme and the phone theme
    }
  });
  it("moves only when motion is welcome: every animated part is still for reduced motion", () => {
    for (const c of ["tm-roadload-sun", "tm-roadload-line", "tm-roadload-name"]) {
      expect(css).toMatch(new RegExp(`\\.${c} \\{ animation:`));
      expect(css).toMatch(new RegExp(`prefers-reduced-motion: reduce\\) \\{[^}]*\\.${c}`));
    }
  });
  it("is the root loading screen", () => {
    expect(html(<RootLoading />)).toContain("tm-roadload");
  });
});
