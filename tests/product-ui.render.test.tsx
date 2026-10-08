import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { Advice, RadarItem, TripHealth } from "@/lib/intel/types";

let pathname = "/trips/00000000-0000-0000-0000-000000000001/live";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => pathname }));
vi.mock("@/lib/client/use-trip-realtime", () => ({ useTripRealtime: vi.fn() }));

import { AutopilotCard } from "@/components/intel/AutopilotCard";
import { NextBestAction } from "@/components/intel/NextBestAction";
import { PulseCard } from "@/components/intel/PulseCard";
import { RadarList } from "@/components/intel/RadarList";
import { TripHealthStrip } from "@/components/intel/TripHealthStrip";
import { UndoToast } from "@/components/intel/UndoToast";
import { AppNav } from "@/components/shell/AppNav";
import { TripTabs } from "@/components/shell/TripTabs";
import { buildNav, currentTrip, type NavTrip } from "@/components/shell/nav";
import { SetupCheck } from "@/components/SetupCheck";
import { StateChip } from "@/components/StateChip";
import { TravelStyle } from "@/components/TravelStyle";
import { TripCard } from "@/components/TripCard";
import { LiveView } from "@/components/LiveView";
import { MapView } from "@/components/MapView";
import { daysUntilStart, tripState } from "@/lib/trip-state";
import { learnFromTrips } from "@/lib/learning";
import type { TripSummary } from "@/lib/server/trip-summaries";

const ID = "00000000-0000-0000-0000-000000000001";
const trips: NavTrip[] = [{ id: ID, name: "Vizag", state: "active" }, { id: "00000000-0000-0000-0000-000000000002", name: "Goa", state: "completed" }];
const open = { state: "open" as const, at: "22:00" };
const poi = (o: Partial<RadarItem> = {}): RadarItem => ({ key: "osm|1", kind: "viewpoint", name: "Sunset Point", lat: 17.1, lng: 80.2, etaMin: 34, aheadKm: 20, detourMin: 8, open, note: "Sunset 42 min after you arrive", score: 80, hours: "24/7", fetchedAt: "2026-10-01T00:00:00Z", ...o });

describe("trip lifecycle", () => {
  it("draft → upcoming → active → completed, from the dates", () => {
    const t = { start_date: "2026-10-10", num_days: 3 };
    expect(tripState({ start_date: null, num_days: 3 }, "2026-10-10")).toBe("draft");
    expect(tripState(t, "2026-10-09")).toBe("upcoming");
    expect(tripState(t, "2026-10-10")).toBe("active");
    expect(tripState(t, "2026-10-12")).toBe("active");
    expect(tripState(t, "2026-10-13")).toBe("completed");
    expect(daysUntilStart(t, "2026-10-07")).toBe(3);
    expect(daysUntilStart(t, "2026-10-11")).toBeNull();
  });
});

describe("navigation", () => {
  it("knows the current trip from the URL, else the active one", () => {
    expect(currentTrip(`/trips/${ID}/plan`, trips)?.id).toBe(ID);
    expect(currentTrip("/dashboard", trips)?.state).toBe("active");
    expect(currentTrip("/dashboard", [])).toBeNull();
  });
  it("points Plan / Live / Map at the current trip, and falls back to My trips with none", () => {
    const items = buildNav("/dashboard", trips);
    expect(items.find((i) => i.id === "plan")!.href).toBe(`/trips/${ID}/plan`);
    expect(items.find((i) => i.id === "live")!.href).toBe(`/trips/${ID}/live`);
    expect(items.find((i) => i.id === "map")!.href).toBe(`/trips/${ID}/map`);
    expect(buildNav("/dashboard", []).find((i) => i.id === "plan")!.href).toBe("/trips");
    expect(items.map((i) => i.id)).toEqual(["dashboard", "discover", "trips", "plan", "explore", "live", "map", "memories", "profile"]);
  });
  it("highlights the right item for each page", () => {
    const active = (path: string) => buildNav(path, trips).filter((i) => i.match(path)).map((i) => i.id);
    expect(active("/trips")).toEqual(["trips"]);
    expect(active(`/trips/${ID}`)).toEqual(["trips"]);
    expect(active(`/trips/${ID}/live`)).toEqual(["live"]);
    expect(active(`/trips/${ID}/explore`)).toEqual(["explore"]);
    expect(active("/memories")).toEqual(["memories"]);
    expect(active("/discover")).toEqual(["discover"]);
  });
  it("renders a labelled sidebar, a mobile bar, the live indicator, and marks the current page", () => {
    const html = renderToStaticMarkup(<AppNav trips={trips} userInitial="B" signOutAction={async () => {}} />);
    expect(html).toContain('aria-label="Main navigation"');
    for (const l of ["Dashboard", "My trips", "Plan", "Explore", "Live trip", "Map", "Memories", "Profile"]) expect(html).toContain(l);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Trip in progress");
    expect(html).toContain("Current trip");
    expect(html).toContain(`/trips/${ID}/live`);
  });
  it("renders trip tabs with the current one marked", () => {
    const html = renderToStaticMarkup(<TripTabs tripId={ID} activeNow />);
    for (const l of ["Overview", "Plan", "Live", "Map", "Explore", "Memories"]) expect(html).toContain(l);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*href="/trips/${ID}/live"`));
    expect(html).not.toMatch(new RegExp(`aria-current="page"[^>]*href="/trips/${ID}/plan"`));
    expect(html).toContain("in progress"); // the live dot, since the trip is active
    pathname = `/trips/${ID}`;
    expect(renderToStaticMarkup(<TripTabs tripId={ID} activeNow={false} />)).toMatch(new RegExp(`aria-current="page"[^>]*href="/trips/${ID}"`));
    pathname = `/trips/${ID}/live`;
  });
  it("StateChip shows a state label", () => {
    expect(renderToStaticMarkup(<StateChip state="active" />)).toContain("Active now");
  });
});

describe("Travel Radar", () => {
  it("lists useful stops ahead with minutes ahead, detour, open status, timely note, and Google Maps links", () => {
    const html = renderToStaticMarkup(<RadarList radar={[poi(), poi({ key: "2", kind: "fuel", name: "HP Pump", etaMin: 21, detourMin: 1, note: null })]} photos={{}} mapping={false} trafficConnected={false} onAdd={() => {}} />);
    expect(html).toContain("2 useful stops ahead");
    expect(html).toContain("34 min ahead");
    expect(html).toContain("8 min detour");
    expect(html).toContain("Open until 22:00");
    expect(html).toContain("Sunset 42 min after you arrive");
    expect(html).toContain("https://www.google.com/maps/dir/?api=1&amp;destination=17.1,80.2"); // Google Maps stays first-class
    expect(html).toContain("https://www.google.com/maps/search/?api=1");
    expect(html).toContain("Add as next stop");
    expect(html).toContain("Live pulse");
    expect(html).toContain("Live traffic and road closures are not connected"); // honest about what it can't see
  });
  it("says it is still mapping, rather than claiming there is nothing", () => {
    const html = renderToStaticMarkup(<RadarList radar={[]} photos={{}} mapping trafficConnected={false} />);
    expect(html).toContain("still mapping");
    expect(html).not.toContain("0 useful");
  });
  it("shows the place's OWN photo (credited) when it has one, an icon tile when not — never a traveler's photo", () => {
    const own = { url: "https://upload.wikimedia.org/p.jpg", source: "osm" as const, creditUrl: "https://commons.wikimedia.org/wiki/File:P.jpg" };
    const a = renderToStaticMarkup(<RadarList radar={[poi()]} photos={{ "osm|1": own }} mapping={false} trafficConnected={false} />);
    expect(a).toContain('alt="Photo of Sunset Point"');
    expect(a).toContain("Photo: Wikimedia");
    expect(a).not.toMatch(/traveler/i);
    const none = renderToStaticMarkup(<RadarList radar={[poi()]} photos={{}} mapping={false} trafficConnected={false} />);
    expect(none).not.toContain("<img");
    expect(none).not.toMatch(/photo by a traveler/i);
  });
});

describe("Autopilot", () => {
  const late: Advice = { id: "late", kind: "late", priority: 90, urgency: "now", title: "Your afternoon is tight", detail: "At this pace you'll finish at 20:40.", action: { type: "replan" }, why: ["Expected finish 20:40 vs target 20:00"] };
  it("explains itself, offers Accept / Keep my plan / Why — and nothing is applied by rendering", () => {
    const html = renderToStaticMarkup(<AutopilotCard advice={late} photos={{}} busy={false} onAccept={() => {}} onKeep={() => {}} />);
    expect(html).toContain("Your afternoon is tight");
    expect(html).toContain("Accept: re-plan from now");
    expect(html).toContain("Keep my plan");
    expect(html).toContain("Why?");
  });
  it("labels each kind of action honestly", () => {
    const label = (action: Advice["action"]) => renderToStaticMarkup(<AutopilotCard advice={{ ...late, action }} photos={{}} busy={false} onAccept={() => {}} onKeep={() => {}} />);
    expect(label({ type: "move_next_day", stopId: "x" })).toContain("Accept: move to tomorrow");
    expect(label({ type: "skip", stopId: "x" })).toContain("Accept: skip it");
    expect(label({ type: "insert_stop", key: "k" })).toContain("Go there");
    expect(label(undefined)).not.toContain("Accept");
  });
  it("hero card: the one thing to do now, with the place's numbers and a Google Maps link", () => {
    const opp: Advice = { id: "detour", kind: "detour", priority: 40, urgency: "soon", title: "Better opportunity found", detail: "Hill Viewpoint is 16 min ahead with clear weather.", action: { type: "insert_stop", key: "k" }, options: [{ key: "k", kind: "viewpoint", name: "Hill Viewpoint", lat: 17, lng: 80, brand: null, hours: null, alongM: 1, offsetM: 1, aheadKm: 12, detourMin: 9, etaMin: 16, arriveClock: "17:10", open, score: 80, reasons: [], tags: {}, fetchedAt: "" }] };
    const html = renderToStaticMarkup(<NextBestAction advice={opp} busy={false} onAccept={() => {}} onKeep={() => {}} onStartDrive={() => {}} fallback={{ title: "x", detail: "y", navigateTo: null, action: null }} />);
    expect(html).toContain("Next best action");
    expect(html).toContain("Better opportunity found");
    expect(html).toContain("Go there");
    expect(html).toContain("Keep my plan");
    expect(html).toContain("16 min ahead");
    expect(html).toContain("9 min detour");
    expect(html).toContain("google.com/maps/dir");
  });
  it("hero with nothing urgent says where you're going and lets you navigate", () => {
    const html = renderToStaticMarkup(<NextBestAction advice={null} busy={false} onAccept={() => {}} onKeep={() => {}} onStartDrive={() => {}} fallback={{ title: "Next: Kondapalli Fort", detail: "On track.", navigateTo: { lat: 16.6, lng: 80.5 }, action: "start-drive" }} />);
    expect(html).toContain("Next: Kondapalli Fort");
    expect(html).toContain("Navigate in Google Maps");
    expect(html).toContain("Start drive");
  });
  it("undo toast announces the change and offers Undo", () => {
    const html = renderToStaticMarkup(<UndoToast undo={{ label: "Moved Fort to Day 2", places: [], deleteIds: [] }} busy={false} onUndo={() => {}} onDismiss={() => {}} />);
    expect(html).toContain("Moved Fort to Day 2");
    expect(html).toContain("Undo");
    expect(html).toContain('role="status"');
    expect(renderToStaticMarkup(<UndoToast undo={null} busy={false} onUndo={() => {}} onDismiss={() => {}} />)).toBe("");
  });
});

describe("Trip health & Pulse", () => {
  const health: TripHealth = { schedule: { label: "Tight", detail: "Only 1h 10m of slack.", tone: "warn" }, driving: { label: "Moderate", minutes: 200, tone: "warn" }, weather: { label: "Unknown", detail: "No forecast available for this route right now.", tone: "unknown" }, timeLeftMin: 270 };
  it("shows four honest numbers; unknown weather is shown as unknown", () => {
    const html = renderToStaticMarkup(<TripHealthStrip health={health} />);
    for (const k of ["Schedule", "Driving left", "Weather", "Time left today"]) expect(html).toContain(k);
    expect(html).toContain("Tight");
    expect(html).toContain("3h 20m");
    expect(html).toContain("4h 30m");
    expect(html).toContain("Unknown");
    expect(renderToStaticMarkup(<TripHealthStrip health={null} />)).toBe("");
  });
  it("Pulse loads only when opened (no request, no fake data on first render)", () => {
    const html = renderToStaticMarkup(<PulseCard name="Kondapalli Fort" lat={16.6} lng={80.5} />);
    expect(html).toContain("Live pulse");
    expect(html).not.toContain("Checking");
    expect(html).not.toContain("Crowd");
  });
});

describe("Trips, learning, setup", () => {
  const trip = (o: Partial<TripSummary> = {}): TripSummary => ({ id: ID, owner_id: "u", name: "Vizag", start_city: "Hyderabad", start_lat: 17, start_lng: 78, dest_name: "Visakhapatnam", dest_lat: 17.7, dest_lng: 83.2, start_date: "2026-10-10", num_days: 3, invite_code: "x", created_at: "", state: "active", daysUntil: null, stops: 6, ideas: 2, done: 2, skipped: 1, ...o });
  it("a trip card has ONE obvious next action per state", () => {
    expect(renderToStaticMarkup(<TripCard trip={trip()} isOwner />)).toContain("Open live trip");
    expect(renderToStaticMarkup(<TripCard trip={trip({ state: "completed" })} isOwner />)).toContain("See memories");
    const upcoming = renderToStaticMarkup(<TripCard trip={trip({ state: "upcoming", daysUntil: 3, done: 0, skipped: 0 })} isOwner />);
    expect(upcoming).toContain("Continue planning");
    expect(upcoming).toContain("IN 3 DAYS");
    const draft = renderToStaticMarkup(<TripCard trip={trip({ state: "draft", stops: 0, ideas: 0, start_date: null, done: 0, skipped: 0 })} isOwner={false} />);
    expect(draft).toContain("Add places");
    expect(draft).toContain("DATES NOT SET");
    expect(draft).toContain("Member");
  });
  it("shows progress only when something was actually done", () => {
    expect(renderToStaticMarkup(<TripCard trip={trip()} isOwner />)).toContain('role="progressbar"');
    expect(renderToStaticMarkup(<TripCard trip={trip({ done: 0, skipped: 0 })} isOwner />)).not.toContain("progressbar");
  });
  it("travel style: honest when there isn't enough, evidence-backed when there is", () => {
    const none = renderToStaticMarkup(<TravelStyle learning={learnFromTrips([], 330)} />);
    expect(none).toContain("Not enough yet");
    expect(none).toContain("don&#x27;t keep a history of where you have been");
  });
  it("setup check explains why and what to do, never shows a key", () => {
    const html = renderToStaticMarkup(<SetupCheck items={[{ id: "ai", label: "AI import (Anthropic)", ok: false, required: false, problem: "The key IS in .env.local, but this running server has not loaded it.", fix: "Stop the server (press Ctrl + C) and run npm run dev again.", fallback: "Pasting Google Maps links still works without AI." }]} />);
    expect(html).toContain("What to do:");
    expect(html).toContain("Ctrl + C");
    expect(html).toContain("Test my AI key");
    expect(html).toContain("Google Maps links still works");
  });
});

describe("Live and Map pages render", () => {
  const trip: Trip = { id: ID, owner_id: "u1", name: "Vizag", start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: "Visakhapatnam", dest_lat: 17.69, dest_lng: 83.2, start_date: "2026-10-10", num_days: 3, invite_code: "x", created_at: "" };
  const place = (id: string, extra: Partial<PlaceWithSeason> = {}): PlaceWithSeason => ({
    id, trip_id: ID, name: `Stop ${id}`, lat: 16.6, lng: 80.5, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1, arrival_time: "09:00:00",
    notes: null, category: "fort", address: null, status: "planned", status_at: null, drive_minutes: null, drive_km: null, added_by: null, created_at: "", season_tags: null, ...extra,
  });
  const members: TripMember[] = [{ id: "m1", trip_id: ID, user_id: "u1", display_name: "Bhanu", avatar_color: "#1C7C6D", joined_at: "" }];
  const props = { trip, members, votes: {}, conditions: {}, userId: "u1", today: "2026-10-06" };

  it("Live: one clear next action, trip health area, radar, up next, Google Maps navigation, drive controls", () => {
    const html = renderToStaticMarkup(<LiveView {...props} places={[place("a"), place("b", { sequence_order: 2, arrival_time: "12:00:00" })]} />);
    expect(html).toContain("Next best action");
    expect(html).toContain("Next: Stop a");
    expect(html).toContain("Navigate in Google Maps");
    expect(html).toContain("Travel Radar");
    expect(html).toContain("Up next");
    expect(html).toContain("Drive mode");
    expect(html).toContain("Start drive");
    expect(html).toContain("This trip isn&#x27;t happening today"); // 6 Oct is before the trip → preview, said plainly
    expect(html).toContain("Search nearby");
    expect(html).toContain("Full-screen map");
  });
  it("Live with an empty day points to the plan instead of showing nothing", () => {
    const html = renderToStaticMarkup(<LiveView {...props} places={[]} />);
    expect(html).toContain("Nothing planned for Day 1");
    expect(html).toContain("Plan this day");
  });
  it("Live: finished stops show as done for the day", () => {
    const html = renderToStaticMarkup(<LiveView {...props} today="2026-10-10" places={[place("a", { status: "done" })]} />);
    expect(html).toContain("Nothing left on Day 1");
  });
  it("Map: layers, radar sheet and start-drive control", () => {
    const html = renderToStaticMarkup(<MapView {...props} places={[place("a")]} />);
    expect(html).toContain("Map layers");
    expect(html).toContain("Radar");
    expect(html).toContain("All places ahead");
    expect(html).toContain("Start drive");
    expect(html).toContain("Travel Radar");
  });
});

import { WeatherSunCard } from "@/components/intel/WeatherSunCard";
describe("Weather & sun card", () => {
  const w = { tempC: 29, precipProb: 30, precipMm: 0, pointKm: 3, next: [{ clock: "11:00", tempC: 29, precipProb: 40 }, { clock: "12:00", tempC: 28, precipProb: 75 }] };
  it("shows temperature, rain chance, the next hours, the next sun event, and credits the weather source", () => {
    const html = renderToStaticMarkup(<WeatherSunCard weather={w} sun={{ sunrise: "06:08", sunset: "17:52" }} sunNext={{ label: "Sunset", clock: "17:52", inMin: 472, tomorrow: false }} where="your location" />);
    expect(html).toContain("29°C");
    expect(html).toContain("30% rain this hour");
    expect(html).toContain("11:00");
    expect(html).toContain("75%");
    expect(html).toContain("Sunset 17:52");
    expect(html).toContain("7h 52m");
    expect(html).toContain("sunrise 06:08, sunset 17:52");
    expect(html).toContain("at your location");
    expect(html).toContain("Open-Meteo.com"); // attribution the weather provider requires
  });
  it("says plainly when there is no forecast instead of inventing weather", () => {
    const html = renderToStaticMarkup(<WeatherSunCard weather={null} sun={{ sunrise: "06:08", sunset: "17:52" }} sunNext={{ label: "Sunrise", clock: "06:08", inMin: 600, tomorrow: true }} where="Hyderabad" />);
    expect(html).toContain("We don&#x27;t guess the weather");
    expect(html).not.toContain("°C");
    expect(html).toContain("Sunrise tomorrow 06:08");
  });
  it("warns when the forecast point is far from you", () => {
    expect(renderToStaticMarkup(<WeatherSunCard weather={{ ...w, pointKm: 40 }} sun={null} sunNext={null} where="the start" />)).toContain("Forecast point is 40 km away");
  });
});
