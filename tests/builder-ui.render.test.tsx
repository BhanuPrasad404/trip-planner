import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TripBuilder } from "@/components/builder/TripBuilder";
import type { PlaceWithSeason } from "@/lib/types";

const place = { id: "p1", name: "Lonavala", lat: 18.75, lng: 73.4, category: "hill_station", priority: "normal" } as unknown as PlaceWithSeason;
const noop = () => {};

describe("TripBuilder first screen", () => {
  it("says in one line what it does and that nothing changes until you choose, with a close button and no step-by-step explainer", () => {
    const html = renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart hasDestination onPreview={noop} onChanged={noop} />);
    expect(html).toContain("Plan my trip");
    expect(html).toContain("using real road times"); expect(html).toContain("Nothing changes until you press Use this plan");
    expect(html).toContain('aria-label="Close Plan my trip"');
    for (const old of ["Tell us what matters", "See if it fits", "three realistic ways"]) expect(html).not.toContain(old);
  });
  it("keeps its anchor id so other parts of the page can point at it", () => {
    expect(renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart hasDestination onPreview={noop} onChanged={noop} />)).toContain('id="plan-assistant"');
  });
  it("asks for places first when there are none, and for a start point when missing", () => {
    expect(renderToStaticMarkup(<TripBuilder tripId="t" places={[]} hasStart hasDestination={false} onPreview={noop} onChanged={noop} />)).toContain("Add places first");
    const noStart = renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart={false} hasDestination={false} onPreview={noop} onChanged={noop} />);
    expect(noStart).toContain("Set a starting point");
    expect(noStart).not.toContain("Tell us what matters");
  });
});
