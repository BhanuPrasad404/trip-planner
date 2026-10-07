import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TripBuilder } from "@/components/builder/TripBuilder";
import type { PlaceWithSeason } from "@/lib/types";

const place = { id: "p1", name: "Lonavala", lat: 18.75, lng: 73.4, category: "hill_station", priority: "normal" } as unknown as PlaceWithSeason;
const noop = () => {};

describe("TripBuilder first screen", () => {
  it("explains what it does and offers to make the trip fit", () => {
    const html = renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart hasDestination onPreview={noop} onChanged={noop} />);
    expect(html).toContain("Trip builder");
    expect(html).toContain("Will your places fit your days?");
    expect(html).toContain("Make my trip fit");
    expect(html).not.toContain("disabled=\"\"");
  });
  it("asks for places first when there are none, and for a start point when missing", () => {
    expect(renderToStaticMarkup(<TripBuilder tripId="t" places={[]} hasStart hasDestination={false} onPreview={noop} onChanged={noop} />)).toContain("Add places first");
    const noStart = renderToStaticMarkup(<TripBuilder tripId="t" places={[place]} hasStart={false} hasDestination={false} onPreview={noop} onChanged={noop} />);
    expect(noStart).toContain("Set a starting point");
    expect(noStart).not.toContain("Make my trip fit");
  });
});
