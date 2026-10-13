import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TripBuilder } from "@/components/builder/TripBuilder";
import type { PlaceWithSeason } from "@/lib/types";

const place = { id: "p1", name: "Lonavala", lat: 18.75, lng: 73.4, category: "hill_station", priority: "normal" } as unknown as PlaceWithSeason;
const noop = () => {};

describe("TripBuilder first screen", () => {
  it("says in plain words what it does, how it works in 3 steps, and that nothing changes until you choose", () => {
    const html = renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart hasDestination onPreview={noop} onChanged={noop} />);
    expect(html).toContain("Plan my trip");
    expect(html).toContain("three realistic ways to fit them into your days");
    for (const step of ["Tell us what matters", "See if it fits", "Pick a plan"]) expect(html).toContain(step);
    expect(html).toContain("Nothing changes in your itinerary until you press");
    expect(html).toContain("you can undo it");
    expect(html).not.toContain("disabled=\"\"");
  });
  it("can be reached from the page header (it has an anchor to jump to)", () => {
    expect(renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart hasDestination onPreview={noop} onChanged={noop} />)).toContain('id="plan-assistant"');
  });
  it("asks for places first when there are none, and for a start point when missing", () => {
    expect(renderToStaticMarkup(<TripBuilder tripId="t" places={[]} hasStart hasDestination={false} onPreview={noop} onChanged={noop} />)).toContain("Add places first");
    const noStart = renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart={false} hasDestination={false} onPreview={noop} onChanged={noop} />);
    expect(noStart).toContain("Set a starting point");
    expect(noStart).not.toContain("Tell us what matters");
  });
});
