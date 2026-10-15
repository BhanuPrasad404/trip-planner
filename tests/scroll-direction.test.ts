import { describe, expect, it } from "vitest";
import { initialScroll, SCROLL_DEFAULTS, stepScroll, type ScrollConfig, type ScrollState } from "@/lib/client/scroll-direction";
import { isDrivingSurface } from "@/components/shell/nav";

const cfg: ScrollConfig = { ...SCROLL_DEFAULTS, maxY: 5000 };
const run = (ys: number[], c: ScrollConfig = cfg, from: ScrollState = initialScroll(0)) => ys.reduce((s, y) => stepScroll(s, y, c), from);
const trace = (ys: number[], c: ScrollConfig = cfg) => { let s = initialScroll(0); return ys.map((y) => (s = stepScroll(s, y, c)).hidden); };

describe("stepScroll: the bottom bar gets out of the way only for real reading", () => {
  it("starts shown, and stays shown near the top however you scroll", () => {
    expect(run([5, 12, 20, 24]).hidden).toBe(false);
  });
  it("reading down far enough hides it", () => {
    expect(run([40, 80, 120, 160]).hidden).toBe(true);
  });
  it("does not hide before the page has been scrolled a real distance, even with fast flicks", () => {
    expect(run([60, 90]).hidden).toBe(false); // 90 is under the 96 px threshold
  });
  it("scrolling UP a little brings it straight back: a nudge of 4 px does not, 9 px does", () => {
    const hidden = run([100, 140, 180, 220]); expect(hidden.hidden).toBe(true);
    expect(stepScroll(hidden, 216, cfg).hidden).toBe(true);
    expect(stepScroll(hidden, 211, cfg).hidden).toBe(false);
  });
  it("jitter does not toggle it: tiny movements in either direction change nothing", () => {
    const hiddenRun = trace([100, 140, 180, 183, 181, 184, 182, 185]);
    expect(hiddenRun.slice(2).every(Boolean)).toBe(true);
    const shownRun = trace([60, 63, 61, 64, 62, 65, 63, 66]);
    expect(shownRun.every((h) => h === false)).toBe(true);
  });
  it("changing direction starts counting from where it changed (a long scroll down then a small nudge up shows it; it does not need to retrace the whole way)", () => {
    const s = run([100, 200, 300, 400]);
    expect(s.hidden).toBe(true);
    expect(stepScroll(s, 391, cfg).hidden).toBe(false);
  });
  it("returning to the top always shows it", () => {
    expect(run([200, 400, 600, 12]).hidden).toBe(false);
  });
  it("at the top the bar is shown whatever state it was in (e.g. a page that reloaded or jumped back to the top while it was tucked away)", () => {
    const stuck: ScrollState = { y: 12, hidden: true, anchor: 12, dir: 1 };
    expect(stepScroll(stuck, 10, cfg).hidden).toBe(false);
    expect(stepScroll(stuck, 12, cfg).hidden).toBe(false);
  });
  it("a page that barely scrolls never hides it (nothing to reclaim)", () => {
    const tiny: ScrollConfig = { ...cfg, maxY: 60 };
    expect(run([30, 50, 60], tiny).hidden).toBe(false);
  });
  it("the rubber-band bounce past either end is not a direction", () => {
    const atBottom = run([4900, 5000]); expect(atBottom.hidden).toBe(true);
    expect(stepScroll(atBottom, 5080, cfg)).toMatchObject({ y: 5000, hidden: true }); // overscroll clamped
    expect(stepScroll(atBottom, -30, cfg).hidden).toBe(false); // negative overscroll at the top = top
  });
  it("ignores unusable readings", () => {
    const s = run([100, 140]); expect(stepScroll(s, Number.NaN, cfg)).toBe(s);
  });
  it("takes sustained travel, not a single twitchy frame, to flip it either way (no flicker over a long wobbly scroll)", () => {
    const wobble = [100, 118, 112, 130, 124, 142, 136, 154, 148, 166]; // net down, with small back-steps
    const flips = trace(wobble).filter((h, i, a) => i > 0 && h !== a[i - 1]).length;
    expect(flips).toBeLessThanOrEqual(1);
  });
});

describe("isDrivingSurface: where the bar must never move", () => {
  it.each(["/trips/abc/live", "/trips/abc/map", "/trips/abc/map/", "/trips/abc/live/x"])("%s is a driving screen", (p) => expect(isDrivingSurface(p)).toBe(true));
  it.each(["/dashboard", "/discover", "/explore", "/trips", "/trips/abc", "/trips/abc/plan", "/trips/abc/memories", "/trips/abc/mapping", "/memories"])("%s is not", (p) => expect(isDrivingSurface(p)).toBe(false));
});
