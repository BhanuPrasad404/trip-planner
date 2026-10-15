import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StateChip } from "@/components/StateChip";
import { TripCard } from "@/components/TripCard";
import type { TripSummary } from "@/lib/server/trip-summaries";
import { tripOutcome } from "@/lib/trip-state";

const base = { id: "00000000-0000-0000-0000-000000000001", owner_id: "u", name: "Vizag", start_city: "Hyderabad", start_lat: 17, start_lng: 78, dest_name: "Visakhapatnam", dest_lat: 17.7, dest_lng: 83.2, start_date: "2026-10-10", num_days: 3, invite_code: "x", created_at: "", daysUntil: null, ideas: 0 };
const past = (done: number, skipped: number, stops = 5): TripSummary => ({ ...base, state: "completed", stops, done, skipped, outcome: tripOutcome("completed", { stops, done, skipped }) });

describe("past trips on the list and dashboard", () => {
  it("a trip where something was done is 'Completed' and links to its saved route on the map", () => {
    const html = renderToStaticMarkup(<TripCard trip={past(3, 1)} isOwner />);
    expect(html).toContain("Completed");
    expect(html).toContain("See memories");
    expect(html).toContain("View on map");
    expect(html).toContain("/trips/00000000-0000-0000-0000-000000000001/map");
  });
  it("a trip whose dates passed with nothing done is 'Dates passed', never 'Completed'", () => {
    const html = renderToStaticMarkup(<TripCard trip={past(0, 0)} isOwner />);
    expect(html).toContain("Dates passed");
    expect(html).not.toContain(">Completed<");
    expect(html).toContain("View on map");
  });
  it("an active or upcoming trip has no 'View on map' shortcut", () => {
    const t: TripSummary = { ...base, state: "active", stops: 5, done: 1, skipped: 0, outcome: tripOutcome("active", { stops: 5, done: 1, skipped: 0 }) };
    expect(renderToStaticMarkup(<TripCard trip={t} isOwner />)).not.toContain("View on map");
  });
  it("the chip uses the outcome label when given, the plain state label otherwise", () => {
    expect(renderToStaticMarkup(<StateChip state="completed" outcome={tripOutcome("completed", { stops: 2, done: 0, skipped: 0 })} />)).toContain("Dates passed");
    expect(renderToStaticMarkup(<StateChip state="completed" />)).toContain("Completed");
    expect(renderToStaticMarkup(<StateChip state="active" />)).toContain("Active now");
  });
});
