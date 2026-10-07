import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlaceWithSeason, Trip } from "@/lib/types";
import type { Conditions } from "@/lib/weather";
import type { ReportView } from "@/lib/reports";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/client/use-trip-realtime", () => ({ useTripRealtime: vi.fn() }));

import { TripPlanner } from "@/components/TripPlanner";
import { PlaceReports } from "@/components/PlaceReports";
import { NearbyPanel } from "@/components/NearbyPanel";
import { TripAlerts } from "@/components/TripAlerts";

const trip: Trip = {
  id: "00000000-0000-0000-0000-000000000001", owner_id: "u1", name: "Test trip", start_city: "Hyderabad",
  start_lat: 17.385, start_lng: 78.4867, dest_name: "Vijayawada", dest_lat: 16.5, dest_lng: 80.6,
  start_date: "2026-10-06", num_days: 2, invite_code: "abc123", created_at: "",
};
const place = (id: string, extra: Partial<PlaceWithSeason> = {}): PlaceWithSeason => ({
  id, trip_id: trip.id, name: `Stop ${id}`, lat: 16.6, lng: 80.5, source_type: "manual", source_url: null, season_tag_id: null,
  day_number: 1, sequence_order: 1, arrival_time: "09:00:00", notes: null, category: "fort", address: null, status: "planned", status_at: null,
  drive_minutes: null, drive_km: null, added_by: null, created_at: "", season_tags: null, ...extra,
});
const NOW = new Date("2026-10-06T12:00:00Z");
const report = (o: Partial<ReportView> = {}): ReportView => ({ id: "r1", tags: ["water_flowing", "crowded"], note: "Strong flow today", photoUrl: "https://cdn.example/p.jpg", createdAt: "2026-10-05T10:00:00Z", mine: false, ...o });

describe("community UI", () => {
  it("PlaceReports shows the summary, notes, photo with alt text and a flag button for others' reports", () => {
    const html = renderToStaticMarkup(<PlaceReports place={{ id: "p", name: "Kuntala", lat: 1, lng: 1 }} reports={[report()]} userId="u1" onChanged={() => {}} now={NOW} />);
    expect(html).toContain("1 recent update");
    expect(html).toContain("Water flowing");
    expect(html).toContain("Strong flow today");
    expect(html).toContain('alt="Photo of Kuntala shared by a traveler"');
    expect(html).toContain("Flag");
    expect(html).not.toContain("A Trailmate"); // authors are never named
    expect(html).toContain("Share an update");
  });

  it("PlaceReports offers Delete (not Flag) on your own report and a clear empty state", () => {
    const mine = renderToStaticMarkup(<PlaceReports place={{ id: "p", name: "K", lat: 1, lng: 1 }} reports={[report({ mine: true })]} userId="u1" onChanged={() => {}} now={NOW} />);
    expect(mine).toContain("Delete");
    expect(mine).not.toContain(">Flag<");
    const empty = renderToStaticMarkup(<PlaceReports place={{ id: "p", name: "K", lat: 1, lng: 1 }} reports={[]} userId="u1" onChanged={() => {}} now={NOW} />);
    expect(empty).toContain("No updates from the last 30 days");
  });

  it("NearbyPanel lists every kind as a button and names its anchor", () => {
    const html = renderToStaticMarkup(<NearbyPanel anchor={{ lat: 1, lng: 1, label: "Kondapalli Fort" }} />);
    for (const k of ["Fuel", "Food", "Pharmacy", "ATM / bank", "Hospital", "Stay", "Sights"]) expect(html).toContain(k);
    expect(html).toContain("Near Kondapalli Fort");
    expect(html).toContain("Follow my location");
  });

  it("TripAlerts renders nothing when empty, and uses alert roles for warnings", () => {
    expect(renderToStaticMarkup(<TripAlerts alerts={[]} />)).toBe("");
    const html = renderToStaticMarkup(<TripAlerts alerts={[{ id: "1", placeId: "p", severity: "warn", text: "Heavy rain forecast" }]} />);
    expect(html).toContain('role="alert"');
  });

  it("TripPlanner shows reports on stops and a weather alert from a real forecast", () => {
    const forecast: Record<string, Conditions> = { a: { kind: "forecast", tempMaxC: 27, precipMmPerDay: 22, rainyDayShare: 1, sampleDays: 1 } };
    const html = renderToStaticMarkup(
      <TripPlanner trip={trip} places={[place("a")]} members={[]} today="2026-10-06" siteUrl="https://x" conditions={forecast} userId="u1" votes={{}} reports={{ a: [report()] }} />
    );
    expect(html).toContain("Heavy rain forecast near Stop a");
    expect(html).toContain("Strong flow today");
  });

  it("TripPlanner shows done stops as done and never nags about their timing", () => {
    const html = renderToStaticMarkup(
      <TripPlanner
        trip={trip} places={[place("a", { status: "done", season_tags: { good_months: [6, 7], reason: "Monsoon only", category: "fort" } })]}
        members={[]} today="2026-10-06" siteUrl="https://x" conditions={{}} userId="u1" votes={{}}
      />
    );
    expect(html).toContain("Done</span>"); // the "Done" badge (tick is now an SVG icon)
    expect(html).not.toContain("Find alternatives");
  });
});

