import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreView, isResearched, type ExploreSeasonTag } from "@/components/ExploreView";
import { AheadBrowser } from "@/components/intel/AheadBrowser";
import type { RankedPoi } from "@/lib/intel/types";

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

  it("by default shows only researched places and counts them truthfully, naming the regions that are really in the data", () => {
    const html = render([researchedAP, researchedTG, starterA, starterB]);
    expect(html).toContain("Araku Valley");
    expect(html).toContain("Warangal Fort");
    expect(html).not.toContain("Bhandardara");
    expect(html).not.toContain("Della Adventure Park");
    expect(html).toContain("Covers 2 places in Andhra Pradesh and Telangana");
    expect(html).not.toContain("Maharashtra");
    expect(html).toContain("Also show 2 unverified"); // available, but opt-in
    expect(html).toContain("Researched");
  });

  it("is honest when nothing is researched yet", () => {
    const html = render([starterA]);
    expect(html).toContain("No researched places are available yet");
    expect(html).not.toContain("Bhandardara");
  });

  it("the live search section stays empty until someone asks (nothing preloaded)", () => {
    const html = render([researchedAP]);
    expect(html).toContain("Around your trip");
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
