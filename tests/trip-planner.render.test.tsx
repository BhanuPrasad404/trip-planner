import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { Conditions } from "@/lib/weather";
import type { VoteSummary } from "@/lib/votes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/client/use-trip-realtime", () => ({ useTripRealtime: vi.fn() })); // needs a browser + Supabase

import { TripPlanner } from "@/components/TripPlanner";

const trip: Trip = {
  id: "00000000-0000-0000-0000-000000000001",
  owner_id: "u1",
  name: "Hyderabad → Maharashtra",
  start_city: "Hyderabad",
  start_lat: 17.385,
  start_lng: 78.4867,
  dest_name: null,
  dest_lat: null,
  dest_lng: null,
  start_date: "2026-10-01", // October: Kalu Waterfall (Jun–Sep only) is out of season
  num_days: 6,
  invite_code: "abc123def456",
  created_at: "2026-10-01T00:00:00Z",
};

const base = {
  trip_id: trip.id,
  source_type: "manual" as const,
  source_url: null,
  season_tag_id: null,
  sequence_order: 1,
  arrival_time: null,
  notes: null,
  category: null,
  address: null,
  status: "planned" as const,
  status_at: null,
  drive_minutes: null,
  drive_km: null,
  added_by: null,
  created_at: "2026-10-01T00:00:00Z",
};

// All on Day 1 so they render by default (Day 1 = 1 Oct).
const places: PlaceWithSeason[] = [
  {
    ...base,
    id: "p1",
    name: "Tiger's Leap Viewpoint",
    lat: 18.7333,
    lng: 73.4064,
    day_number: 1,
    arrival_time: "08:30:00",
    season_tags: { good_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], reason: null, category: "viewpoint" },
  },
  {
    ...base,
    id: "p2",
    name: "Kalu Waterfall",
    lat: 18.7645,
    lng: 73.4155,
    day_number: 1,
    sequence_order: 2,
    season_tags: { good_months: [6, 7, 8, 9], reason: "Dry outside monsoon (Jun-Sep)", category: "waterfall" },
  },
  {
    ...base,
    id: "p3",
    name: "Unmatched Cafe",
    lat: 18.75,
    lng: 73.41,
    day_number: 1,
    sequence_order: 3,
    season_tags: null,
    source_url: "https://instagram.com/reel/xyz",
  },
];

const members: TripMember[] = [
  { id: "m1", trip_id: trip.id, user_id: "u1", display_name: "Bhanu", avatar_color: "#1C7C6D", joined_at: "" },
  { id: "m2", trip_id: trip.id, user_id: "u2", display_name: "Evil", avatar_color: "red;background:url(x)", joined_at: "" },
];

const dry: Conditions = { kind: "typical", tempMaxC: 31, precipMmPerDay: 0.3, rainyDayShare: 0.02, sampleDays: 90 };

const render = (
  p: PlaceWithSeason[] = places,
  t: Trip = trip,
  conditions: Record<string, Conditions> = {},
  votes: Record<string, VoteSummary> = {}
) =>
  renderToStaticMarkup(
    <TripPlanner trip={t} places={p} members={members} today="2026-10-06" siteUrl="https://trailmate.example" conditions={conditions} userId="u1" votes={votes} />
  );

describe("TripPlanner render", () => {

  it("flags out-of-season stops using the visit date (October vs Jun–Sep waterfall)", () => {
    const html = render();
    expect(html).toContain("Out of season");
    expect(html).toContain("Dry outside monsoon (Jun-Sep)");
    expect(html).toContain("1 stop needs"); // sidebar summary
    expect(html).toContain("Season unknown"); // unmatched place
    expect(html).toContain("In season");
  });

  it("treats the same waterfall as in season when the trip starts in July", () => {
    const html = render(places, { ...trip, start_date: "2026-07-01" });
    expect(html).not.toContain("Out of season");
    expect(html).toContain("Timing looks good");
  });




  it("opens source reels safely", () => {
    expect(render()).toContain('rel="noopener noreferrer nofollow"');
  });

  it("explains why auto-plan is disabled", () => {
    expect(render([])).toContain("Add a few places to enable auto-planning.");
    expect(render(places, { ...trip, start_lat: null, start_lng: null })).toContain("no start point");
  });

  it("shows the empty state for an empty day", () => {
    expect(render([])).toContain("Nothing on Day 1 yet");
  });

  it("shows an explainable Go Score when weather data is available (dry October kills a waterfall)", () => {
    const html = render(places, trip, { p2: dry, p1: dry });
    expect(html).toContain("Go score");
    expect(html).toContain("Likely dry");
    expect(html).toContain("Trip readiness");
  });

  it("shows no Go Score (rather than a fake one) when nothing is known", () => {
    const html = render([{ ...places[2] }]);
    expect(html).not.toContain("Go score ·"); // no badge
    expect(html).not.toContain("Timing looks good"); // and no false reassurance
    expect(html).toContain("can&#x27;t judge their timing");
  });

  it("shows drive legs and driving time on a planned day", () => {
    const planned = places.map((p, i) => ({ ...p, drive_minutes: 90 + i * 30, drive_km: 60 + i * 20 }));
    const html = render(planned);
    expect(html).toContain("1 h 30 min");
    expect(html).toContain("from previous point");
    expect(html).toContain("DRIVING");
  });

  it("puts unscheduled places in the Ideas pool, with a way to schedule them", () => {
    const ideas = [{ ...places[0], id: "i1", name: "Idea Fort", day_number: null }];
    const html = render(ideas);
    expect(html).toContain("Idea Fort");
    expect(html).toContain("Ideas");
    expect(html).toContain("Schedule on");
    expect(html).toContain("Nothing on Day 1 yet");
  });

  it("offers smart import and renders the map slot", () => {
    const html = render();
    expect(html).toContain("Import places");
    expect(html).toContain("animate-pulse"); // map placeholder; MapLibre only loads in the browser
  });


  it("shows group votes with accessible state, and the ideas the group likes best come first", () => {
    const ideas = [
      { ...places[0], id: "a", name: "Meh Fort", day_number: null, sequence_order: 1 },
      { ...places[0], id: "b", name: "Loved Fort", day_number: null, sequence_order: 2 },
    ];
    const html = render(ideas, trip, {}, { b: { up: 3, down: 0, score: 3, mine: 1 }, a: { up: 0, down: 1, score: -1, mine: 0 } });
    expect(html.indexOf("Loved Fort")).toBeLessThan(html.indexOf("Meh Fort"));
    expect(html).toContain('aria-pressed="true"'); // my up-vote on Loved Fort
    expect(html).toContain("Group vote for Loved Fort");
  });

  it("offers a way to fix a wrong pin and shows where the geocoder put each place", () => {
    const html = render([{ ...places[0], address: "Lonavala, Pune District, Maharashtra" }]);
    expect(html).toContain("Wrong location?");
    expect(html).toContain("Lonavala, Pune District, Maharashtra");
  });

  it("offers alternatives only for stops with poor timing", () => {
    const html = render(places, trip, { p2: dry, p1: dry }); // October: waterfall is dry => poor
    expect(html).toContain("Find alternatives");
    expect(html.match(/Find alternatives/g)?.length).toBe(1); // only the waterfall, not the viewpoint
  });


  it("warns on a Maharashtra stop in a Vijayawada trip and lists it under 'Pins to double-check'", () => {
    const vijayawada = { ...trip, start_city: "Hyderabad", dest_name: "Vijayawada", dest_lat: 16.5062, dest_lng: 80.648 };
    const html = render(places, vijayawada); // the fixtures are Maharashtra places
    expect(html).toContain("Pins to double-check");
    expect(html).toMatch(/\d+ km from Vijayawada — is this pin right\?/);
  });

  it("does not nag when the stops are near the destination", () => {
    const near: PlaceWithSeason[] = [{ ...places[0], lat: 16.62, lng: 80.53 }];
    const html = render(near, { ...trip, dest_name: "Vijayawada", dest_lat: 16.5062, dest_lng: 80.648 });
    expect(html).not.toContain("Pins to double-check");
    expect(html).not.toContain("is this pin right");
  });

  it("shows where the season info came from, with a link", () => {
    const sourced: PlaceWithSeason[] = [{
      ...places[1],
      season_tags: { good_months: [6, 7, 8, 9], reason: "Dry outside monsoon", category: "waterfall", confidence: "researched", source_urls: ["https://en.wikipedia.org/wiki/Kuntala_Waterfall", "https://www.sotc.in/blog/?p=8517"] },
    }];
    const html = render(sourced);
    expect(html).toContain("Season info: researched");
    expect(html).toContain("en.wikipedia.org");
    expect(html).toContain("+1 more");
  });

});

