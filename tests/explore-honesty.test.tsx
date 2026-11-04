import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreView, isResearched, type ExploreSeasonTag } from "@/components/ExploreView";
import { AheadBrowser } from "@/components/intel/AheadBrowser";
import type { RankedPoi } from "@/lib/intel/types";
// Explore with a trip shows the trip section, which can send the person to Discover: a router stand-in for these tests.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }) }));

const tag = (o: Partial<ExploreSeasonTag>): ExploreSeasonTag => ({
  id: "i", place_name: "Place", lat: 17, lng: 80, category: "fort", good_months: [10, 11, 12], reason: "Cool season.", region: "Andhra Pradesh",
  confidence: "researched", source_urls: ["https://example.com/a"], distanceKm: 100, ...o,
});
const researchedAP = tag({ id: "1", place_name: "Araku Valley", category: "hill_station" });
const researchedTG = tag({ id: "2", place_name: "Warangal Fort", region: "Telangana" });
// Rows that came from the developer starter file: no source, one is "open all year" (no real season at all).
const starterA = tag({ id: "3", place_name: "Bhandardara", region: "Maharashtra", confidence: null, source_urls: null, good_months: [6, 7, 8, 9, 10] });
const starterB = tag({ id: "4", place_name: "Della Adventure Park", region: "Maharashtra", confidence: null, source_urls: null, good_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], reason: null });
const render = (tags: ExploreSeasonTag[]) => renderToStaticMarkup(<ExploreView tripId="t" anchors={[{ id: "d", label: "Visakhapatnam", lat: 17.7, lng: 83.2 }]} seasonTags={tags} month={10} />);

describe("Explore does not dress up unsourced data as research", () => {
  it("only rows with a shown source count as researched", () => {
    expect(isResearched(researchedAP)).toBe(true);
    expect(isResearched(starterA)).toBe(false);
    expect(isResearched(tag({ confidence: "researched", source_urls: [] }))).toBe(false);
    expect(isResearched(tag({ confidence: "draft" }))).toBe(false);
  });

  it("'Best in <month>' is not a fixed list: nothing is preloaded, and it asks the server about where the traveller is", () => {
    const html = render([researchedAP, researchedTG, starterA, starterB]);
    expect(html).toContain("Best in October");
    expect(html).toContain("Near my trip");
    expect(html).toContain("Near me");
    expect(html).toContain("A state");
    for (const name of ["Araku Valley", "Warangal Fort", "Bhandardara", "Della Adventure Park"]) expect(html).not.toContain(name); // no static list in the page
    expect(html).not.toContain("Maharashtra");
  });

  it("with no trip and no remembered state it asks where to look instead of showing a list for everybody", () => {
    const html = renderToStaticMarkup(<ExploreView tripId={null} anchors={[]} seasonTags={[researchedAP]} month={10} />);
    expect(html).toContain("Pick where you are, or a state, to see what is best in October");
    expect(html).not.toContain("Araku Valley");
  });

  it("a visitor with no trip gets a list for their rough area straight away, and says it is approximate", () => {
    const html = renderToStaticMarkup(<ExploreView tripId={null} anchors={[]} seasonTags={[]} month={11} guess={{ lat: 28.6, lng: 77.2 }} />);
    expect(html).toContain("near your area");
    expect(html).toContain("approximate area");
    expect(html).not.toContain("Pick where you are");
  });

  it("the food, stays and fuel section stays empty until someone asks (nothing preloaded)", () => {
    const html = render([researchedAP]);
    expect(html).toContain("near your trip");
    expect(html).not.toContain("km away");
  });
});

describe("Along your route (browse by type)", () => {
  const p = (name: string, kind: RankedPoi["kind"], aheadKm: number): RankedPoi => ({ key: name, kind, name, lat: 17, lng: 80, brand: null, hours: null, alongM: aheadKm * 1000, offsetM: 10, aheadKm, detourMin: 0, etaMin: aheadKm, arriveClock: "10:00", open: { state: "unknown" }, score: 60, reasons: [], tags: {}, fetchedAt: "" });
  it("offers a chip per kind with counts, and lists nothing until one is chosen", () => {
    const html = renderToStaticMarkup(<AheadBrowser aheadByKind={{ fuel: [p("HP", "fuel", 5), p("IOC", "fuel", 20)], restroom: [p("Toilets", "restroom", 9)] }} photos={{}} />);
    expect(html).toContain("Along your route");
    expect(html).toContain("Fuel · 2");
    expect(html).toContain("Restroom · 1");
    expect(html).not.toContain("HP");
  });
  it("renders nothing when nothing was found", () => {
    expect(renderToStaticMarkup(<AheadBrowser aheadByKind={{}} photos={{}} />)).toBe("");
  });
});
