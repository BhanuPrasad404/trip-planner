import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FuelCard, HaltLine, PlanLabels, TransitDayCard, WhatIfStepper } from "@/components/builder/EngineExtras";
import { planTrip } from "@/lib/engine/plan";
import { PERMIT_CHECK } from "@/lib/engine/permits";
import { toView } from "@/lib/server/trip-engine";
import { makeInput } from "./builder-fixtures";
import { engineInput, straightLine, townFinder, townsAlong } from "./engine-fixtures";

const HYD = { lat: 17.385, lng: 78.4867 }, MANALI = { lat: 32.2432, lng: 77.1892 };

function manali(days: number) {
  const specs = [{ name: "Hadimba Temple", at: [32.2484, 77.1806] as [number, number], category: "temple" as const }, { name: "Solang Valley", at: [32.3166, 77.1572] as [number, number], category: "viewpoint" as const }];
  const b = makeInput(specs, { numDays: days, endMode: "start", startDateISO: "2026-05-10" });
  const start = { ...HYD, label: "Hyderabad" };
  const line = straightLine(HYD, MANALI);
  const sec = line.durations.reduce((a, c) => a + c, 0), m = line.distances.reduce((a, c) => a + c, 0);
  const near = b.matrix;
  const pts = [start, ...b.places];
  const durations = pts.map((_, i) => pts.map((_, j) => (i === j ? 0 : i === 0 || j === 0 ? sec : near.durations[i][j])));
  const distances = pts.map((_, i) => pts.map((_, j) => (i === j ? 0 : i === 0 || j === 0 ? m : near.distances[i][j])));
  const input = engineInput({ ...b, start, matrix: { durations, distances, source: "osrm" } }, { outLine: line, towns: townFinder([...townsAlong(HYD, MANALI, 25), { name: "Manali", area: "Kullu, Himachal Pradesh", lat: 32.2432, lng: 77.1892, pop: 30_000 }]), states: ["Himachal Pradesh", "Himachal Pradesh"] });
  const plan = planTrip(input);
  return { plan, view: toView(plan, input) };
}

describe("engine parts of Plan my trip", () => {
  const { view } = manali(10);
  const most = view.variants.find((v) => v.id === "most")!;

  it("shows a drive day with its towns, time, km and the dark rule", () => {
    const html = renderToStaticMarkup(<TransitDayCard t={most.transitOut[0]} kind="out" />);
    expect(html).toContain("Drive day");
    expect(html).toContain(`Day ${most.transitOut[0].day}`);
    expect(html).toContain("Hyderabad →");
    expect(html).toMatch(/\d+ h( \d+ min)? driving/);
  });
  it("shows a night halt and says when its drive is estimated or the town is small", () => {
    const html = renderToStaticMarkup(<HaltLine h={{ day: 2, town: "Kasol", area: "Kullu", km: 8.1, driveMin: 12, pop: 3000, checkStays: true, atStop: false }} />);
    expect(html).toContain("Night halt"); expect(html).toContain("Kasol"); expect(html).toContain("(estimated)"); expect(html).toContain("check stays here");
  });
  it("what-if stepper starts at the trip's days, with − and + buttons", () => {
    const html = renderToStaticMarkup(<WhatIfStepper v={most} numDays={10} canEdit busy={false} onPlan={() => {}} />);
    expect(html).toContain("10 days");
    expect(html).toContain('aria-label="One day fewer"'); expect(html).toContain('aria-label="One day more"');
    expect(html).toContain("quick estimate");
  });
  it("fuel shows litres, never rupees before a price is typed", () => {
    const html = renderToStaticMarkup(<FuelCard km={4200} defaultMileage={15} />);
    expect(html).toContain("280 litres");
    expect(html).not.toContain("₹2");
    expect(html).toContain("change it to your vehicle");
    expect(renderToStaticMarkup(<FuelCard km={100} defaultMileage={null} />)).toBe("");
  });
  it("How sure is this plan? lists the margin, weather, daylight and halts labels", () => {
    const html = renderToStaticMarkup(<PlanLabels e={view} />);
    expect(html).toContain("How sure is this plan?");
    expect(html).toContain("+15%, +30% on hill roads");
    expect(html).toContain("No driving after dark");
    expect(html).toContain("real towns (GeoNames)");
  });
  it("permits carry the check sentence", () => {
    const html = renderToStaticMarkup(<PlanLabels e={{ ...view, permits: [`Tawang: Arunachal Pradesh may need an Inner Line Permit (ILP) for Indian visitors. ${PERMIT_CHECK}`] }} />);
    expect(html).toContain("Permits");
    expect(html).toContain("Rules change, check the official site before you go.");
  });
});
