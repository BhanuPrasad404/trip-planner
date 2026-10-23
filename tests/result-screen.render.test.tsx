// Phase 4 "Your plan": the result screen (rendered with a REAL ready-made example), its pure model, the example → save-step hand-off,
// and the save step's suggested dates.
import { readdirSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ComparePlans, DonePanel, ResultView, StopSheet } from "@/components/result/ResultView";
import { DayCard } from "@/components/result/DayCard";
import { PlanFlow } from "@/components/plan/PlanFlow";
import { effectiveAnswers, tripRequests } from "@/lib/intake/draft";
import { suggestStartDate } from "@/lib/intake/start-date";
import { EXAMPLE_LINKS } from "@/lib/result/example-list";
import { exampleDraft } from "@/lib/result/example-draft";
import { EXAMPLES, exampleBySlug } from "@/lib/result/examples";
import { dayPoints, stopNumbers, variantOf, verdict } from "@/lib/result/model";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
const render = (el: ReturnType<typeof h>) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router as never }, el));
const kochi = exampleBySlug("kochi-munnar-alleppey")!;

describe("the ready-made examples are real and complete", () => {
  it("the light link list matches the examples", () => {
    expect(EXAMPLE_LINKS.map((e) => e.slug)).toEqual(EXAMPLES.map((e) => e.slug));
    for (const l of EXAMPLE_LINKS) expect(exampleBySlug(l.slug)!.title).toBe(l.title);
  });
  it("each has three plans from the engine, real places with coordinates, and a road line for every planned day", () => {
    for (const e of EXAMPLES) {
      expect(e.data.options).toHaveLength(3);
      expect(e.data.engine.variants).toHaveLength(3);
      for (const p of e.places) { expect(p.lat).toBeGreaterThan(6); expect(p.lng).toBeGreaterThan(68); }
      for (const o of e.data.options) for (const d of dayPoints(e.data, o.style)) expect(e.lines[o.style][String(d.day)]?.length).toBeGreaterThan(1);
      expect(e.data.engine.labels.roads).toBe("routed"); // made with the live road network, not estimates
    }
  });
});

describe("the result screen (example)", () => {
  const html = render(h(ResultView, { kind: "example", example: kochi, signedIn: false }));
  it("names the trip, says it is a real example, and offers the three plans as a radio group with one chosen", () => {
    expect(html).toContain("Kochi → Munnar → Alleppey");
    expect(html).toContain("A real plan made with live road data on");
    expect(html).toContain('role="radiogroup" aria-label="Choose a plan"');
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
  });
  it("one verdict line in words (with an icon), the days with numbered stops, and sign-up only at Save", () => {
    expect(html).toMatch(/All 5 places fit|places? left out|Doesn&#x27;t fit/);
    expect(html).toContain("Day 1");
    expect(html).toContain("Sign up and save this trip");
    expect(html).not.toContain("Use the ");
  });
  it("keeps details folded: what if, fuel and tolls, how sure", () => {
    expect(html).toContain("What if I had more or fewer days?");
    expect(html).toContain("Fuel and tolls");
    expect(html).toContain("How sure is this plan?");
  });
  it("a signed-in visitor saves without the sign-up words", () => {
    expect(render(h(ResultView, { kind: "example", example: kochi, signedIn: true }))).toContain(">Save this trip<");
  });
});

describe("pieces of the screen", () => {
  it("compare: a real table with a header for each plan", () => {
    const t = render(h(ComparePlans, { data: kochi.data, total: 5 }));
    expect(t).toContain("<table"); expect(t).toContain('scope="row"'); expect(t).toContain("Longest day");
    for (const v of kochi.data.engine.variants) expect(t).toContain(v.label);
  });
  it("the stop sheet is a labelled dialog with big actions; the done panel links to Plan, Live, Map and Weather", () => {
    const stop = kochi.data.options[1].days.flatMap((d) => d.stops)[0];
    const s = render(h(StopSheet, { stop, must: false, place: { id: "p", name: "x", lat: 10, lng: 77 }, busy: false, onClose: () => {}, onMust: () => {}, onSkip: () => {} }));
    expect(s).toContain('role="dialog"'); expect(s).toContain('aria-modal="true"'); expect(s).toContain("Must see"); expect(s).toContain("Skip this place"); expect(s).toContain("Open in Maps");
    const d = render(h(DonePanel, { tripId: "t1", busy: false, onUndo: () => {} }));
    for (const sub of ["plan", "live", "map", "weather"]) expect(d).toContain(`href="/trips/t1/${sub}"`);
    expect(d).toContain("Undo");
  });
  it("a stop says its number in words too (not only the coloured badge)", () => {
    const o = kochi.data.options[1];
    const n = stopNumbers(o);
    const card = render(h(DayCard, { d: o.days[0], numbers: n, halt: null, mustIds: new Set<string>() }));
    expect(card).toContain(`Stop ${n.get(o.days[0].stops[0].placeId)}.`);
  });
});

describe("the model", () => {
  it("stop numbers run through the whole plan; verdict words match the plan", () => {
    const { option, view } = variantOf(kochi.data, "balanced");
    const n = stopNumbers(option!);
    expect([...n.values()]).toEqual(Array.from({ length: n.size }, (_, i) => i + 1));
    const v = verdict(option!, view, kochi.days);
    expect(v.text).toMatch(/fit|left out/);
  });
  it("day points start at the trip start and continue from each day's last stop", () => {
    const pts = dayPoints(kochi.data, "balanced");
    expect(pts[0].points[0]).toEqual({ lat: kochi.data.start.lat, lng: kochi.data.start.lng });
    if (pts[1]) expect(pts[1].points[0]).toEqual(pts[0].points[pts[0].points.length - (kochi.data.options[1].days[0].returnLeg ? 2 : 1)]);
  });
});

describe("Save this trip (example → the save step)", () => {
  it("becomes a draft with the same start, places, kinds of place and answers", () => {
    const d = exampleDraft(kochi);
    const eff = effectiveAnswers(d, []);
    const req = tripRequests(d, eff, "", "2026-12-12");
    expect(req.trip.start_city).toBe(kochi.data.start.label);
    expect(req.trip.num_days).toBe(kochi.days);
    expect(req.trip.start_date).toBe("2026-12-12");
    expect(req.places.map((p) => p.name)).toEqual(kochi.places.map((p) => p.name));
    expect(req.places.map((p) => p.category)).toEqual(kochi.places.map((p) => p.category));
  });
  it("the save step shows a suggested name, the dates to confirm, and sign-up only here", () => {
    const html = render(h(PlanFlow, { signedIn: false, initial: { draft: exampleDraft(kochi), step: "ready" } }));
    expect(html).toContain("Save your trip");
    expect(html).toContain("Trip name");
    expect(html).toContain('type="date"');
    expect(html).toContain("No dates yet");
    expect(html).toContain("Sign up and save this trip");
  });
  it("the start step links to the finished examples", () => {
    const html = render(h(PlanFlow, { signedIn: false }));
    for (const e of EXAMPLE_LINKS) expect(html).toContain(`href="/plan/example/${e.slug}"`);
  });
});

describe("suggested first day", () => {
  it("the next Saturday, never today", () => {
    expect(suggestStartDate("2026-10-23", null)).toBe("2026-10-24"); // Fri → Sat
    expect(suggestStartDate("2026-10-24", null)).toBe("2026-10-31"); // a Saturday today → next Saturday
  });
  it("in the month they said (this year, or next year if it's over)", () => {
    expect(suggestStartDate("2026-10-23", 12)).toBe("2026-12-05");
    expect(suggestStartDate("2026-10-23", 2)).toBe("2027-02-06");
    expect(suggestStartDate("2026-10-23", 10)).toBe("2026-10-24");
  });
  it("stays in that month when its last Saturday is gone, and moves to next year when the month is over", () => {
    expect(suggestStartDate("2026-10-30", 10)).toBe("2026-10-31"); // Saturday 31 Oct is still in October
    expect(suggestStartDate("2026-12-27", 12)).toBe("2026-12-28"); // last Saturday of Dec 2026 has passed: Monday 28th
    expect(suggestStartDate("2026-10-31", 10)).toBe("2027-10-02"); // nothing of October 2026 is left: October 2027
  });
});

describe("theme: the new screens use theme colours, not fixed ones", () => {
  it("no hex colours or fixed Tailwind palette colours in the result components", () => {
    for (const f of readdirSync("components/result").filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(`components/result/${f}`, "utf8").replace(/cssVar\([^()]*(?:\([^()]*\))?[^()]*, "#[0-9a-fA-F]{3,8}"\)/g, "cssVar()"); // a theme variable's fallback is allowed
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(src, f).not.toMatch(/\b(?:bg|text|border)-(?:black|gray|slate|red|green|blue|yellow)\b/);
    }
  });
});
