// Task 11: the landing page's example is a REAL route from our season data — no invented stops, times or numbers.
import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));

import seasonData from "@/data/season-tags.json";
import { SAMPLE_MONTHS, SAMPLE_ROUTE, monthWindow, sampleStops } from "@/lib/landing-sample";
import { LandingSample } from "@/components/LandingSample";
import LandingPage from "@/app/page";

type Tag = { place_name: string; good_months: number[]; reason: string; confidence: string };
const tags = (seasonData as { places: Tag[] }).places;
const byMonth = Object.fromEntries(SAMPLE_MONTHS.map((m) => [m, sampleStops(m)]));

describe("the example route comes from the real season data", () => {
  it("every stop is a researched place in data/season-tags.json", () => {
    for (const name of SAMPLE_ROUTE) {
      const t = tags.find((p) => p.place_name === name);
      expect(t, name).toBeDefined();
      expect(t!.confidence).toBe("researched");
    }
  });
  it("for ALL 12 months, each badge is exactly what the place's own good months say, and the reason is the data's text", () => {
    for (let m = 1; m <= 12; m++) {
      for (const s of sampleStops(m)) {
        const t = tags.find((p) => p.place_name === s.name)!;
        expect(s.status, `${s.name} in month ${m}`).toBe(t.good_months.includes(m) ? "good" : "wrong_season");
        expect(s.reason).toBe(t.reason);
      }
    }
  });
  it("the two months shown really differ: it demonstrates WHEN matters", () => {
    const aug = byMonth[8].map((s) => s.status), dec = byMonth[12].map((s) => s.status);
    expect(aug).not.toEqual(dec);
    expect(aug).toContain("good"); expect(aug).toContain("wrong_season");
    expect(dec).toContain("good"); expect(dec).toContain("wrong_season");
  });
  it("a place removed from the data fails loudly instead of showing a made-up stop", () => {
    const without = { places: (seasonData as { places: Tag[] }).places.filter((p) => p.place_name !== "Ramappa Temple") };
    expect(() => sampleStops(8, without as never)).toThrow(/Ramappa Temple/);
  });
  it("month windows read naturally, including across the new year", () => {
    expect(monthWindow([10, 11, 12, 1, 2, 3])).toBe("Oct–Mar");
    expect(monthWindow([6, 7, 8, 9, 10, 11])).toBe("Jun–Nov");
    expect(monthWindow([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe("all year");
    expect(monthWindow([1, 5])).toBe("Jan, May");
  });
});

describe("the card", () => {
  const textOf = (n: TestRenderer.ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));

  it("switching August ↔ December changes the badges, never the places", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(createElement(LandingSample, { byMonth })); });
    const aug = textOf(r.root);
    expect(aug).toContain(`In August, ${byMonth[8].filter((s) => s.status === "good").length} of 4 stops are in season.`);
    act(() => { r.root.findAllByType("button").find((b) => textOf(b) === "December")!.props.onClick(); });
    const dec = textOf(r.root);
    expect(dec).toContain(`In December, ${byMonth[12].filter((s) => s.status === "good").length} of 4 stops are in season.`);
    for (const name of SAMPLE_ROUTE) { expect(aug).toContain(name); expect(dec).toContain(name); }
    act(() => r.unmount());
  });

  it("the landing page shows it with the Example label, and no invented times, km or old made-up places", () => {
    const html = renderToStaticMarkup(LandingPage() as never);
    expect(html).toContain("Example route");
    expect(html).toContain("Example from our researched season data");
    for (const name of SAMPLE_ROUTE) expect(html).toContain(name);
    const card = html.slice(html.indexOf("Example route"), html.indexOf("Example from our researched season data"));
    expect(card).not.toMatch(/\b\d{1,2}:\d{2}\b/); // no clock times
    expect(card).not.toMatch(/\d\s?km\b/); // no distances
    for (const old of ["Tiger&#x27;s Leap", "Kalu Waterfall", "Della Adventure Park", "Maharashtra"]) expect(html).not.toContain(old);
  });

  it("the source code no longer hard-codes stops on the landing page", () => {
    const src = readFileSync("app/page.tsx", "utf8");
    expect(src).not.toMatch(/time:\s*"\d{2}:\d{2}"/);
  });
});
