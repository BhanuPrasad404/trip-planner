import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TripMember } from "@/lib/types";
import type { Drive, DriveTarget } from "@/lib/client/use-drive";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/client/use-trip-realtime", () => ({ useTripRealtime: vi.fn() }));

import { DrivePanel } from "@/components/DrivePanel";

const NOW = new Date(2026, 9, 10, 9, 40).getTime(); // 09:40 local
const stops: DriveTarget[] = [
  { id: "a", name: "Kondapalli Fort", lat: 16.6, lng: 80.5, plannedArrival: "10:00" },
  { id: "b", name: "Kolleru Lake", lat: 16.6, lng: 81.2, plannedArrival: "13:00" },
];
const members: TripMember[] = [
  { id: "m1", trip_id: "t", user_id: "me", display_name: "Bhanu", avatar_color: "#1C7C6D", joined_at: "" },
  { id: "m2", trip_id: "t", user_id: "u2", display_name: "Arjun", avatar_color: "#C1542C", joined_at: "" },
  { id: "m3", trip_id: "t", user_id: "u3", display_name: "Sai", avatar_color: "#3B6EA5", joined_at: "" },
];
const base: Drive = {
  active: false, share: true, me: null, manualPlace: null, setManual: () => {}, quality: null, locating: false, session: 1, error: null, route: null, drivingMin: null, members: {},
  start: () => {}, stop: () => {}, setShare: () => {},
};
const render = (drive: Partial<Drive>, extra: Partial<React.ComponentProps<typeof DrivePanel>> = {}) =>
  renderToStaticMarkup(
    <DrivePanel drive={{ ...base, ...drive }} members={members} userId="me" stops={stops} stayMinutes={() => 60} comparePlan dayLabel="Day 1" nowMs={NOW} {...extra} />
  );

describe("DrivePanel", () => {
  it("not driving: explains the feature, asks for consent to share, offers Start", () => {
    const html = render({});
    expect(html).toContain("Not driving");
    expect(html).toContain("Start drive");
    expect(html).toContain("Share my live location");
    expect(html).toContain("Not sharing"); // friends who haven't shared
  });

  it("driving without a fix yet shows a calm waiting message", () => {
    const html = render({ active: true });
    expect(html).toContain("Finding your location");
  });

  it("driving with a route shows next stop, distance, minutes, arrival time, speed and plan delay", () => {
    const html = render({
      active: true,
      me: { lat: 16.5, lng: 80.6, heading: 90, speedKmh: 54, accuracyM: 8, at: NOW, fixAt: NOW },
      route: { legs: [{ km: 20, minutes: 30 }, { km: 40, minutes: 50 }], line: [], source: "osrm", stopIds: ["a", "b"], at: NOW },
    });
    expect(html).toContain("Next stop");
    expect(html).toContain("Kondapalli Fort");
    expect(html).toContain("20 km");
    expect(html).toContain("30 min");
    expect(html).toContain("10:10"); // 09:40 + 30
    expect(html).toContain("54"); // speed
    expect(html).toContain("10 min behind plan"); // planned 10:00
    expect(html).toContain("Coming up on Day 1");
    expect(html).toContain("Kolleru Lake");
    expect(html).toContain("Stop drive");
    expect(html).not.toContain("estimates");
  });

  it("says plainly when times are only estimates", () => {
    const html = render({
      active: true,
      me: { lat: 16.5, lng: 80.6, heading: null, speedKmh: null, accuracyM: null, at: NOW, fixAt: NOW },
      route: { legs: [{ km: 20, minutes: 30 }, { km: 40, minutes: 50 }], line: [], source: "estimate", stopIds: ["a", "b"], at: NOW },
    });
    expect(html).toContain("estimates");
  });

  it("does not compare with the plan when the day being driven is not today", () => {
    const html = render(
      { active: true, me: { lat: 16.5, lng: 80.6, heading: null, speedKmh: null, accuracyM: null, at: NOW, fixAt: NOW }, route: { legs: [{ km: 5, minutes: 8 }, { km: 5, minutes: 8 }], line: [], source: "osrm", stopIds: ["a", "b"], at: NOW } },
      { comparePlan: false }
    );
    expect(html).not.toContain("behind plan");
    expect(html).not.toContain("On time");
  });

  it("lists friends who are sharing with freshness and distance, and others as not sharing", () => {
    const html = render({
      active: true,
      me: { lat: 16.5, lng: 80.6, heading: null, speedKmh: null, accuracyM: null, at: NOW, fixAt: NOW },
      members: { u2: { user_id: "u2", lat: 16.5, lng: 80.7, heading: null, speed_kmh: 62, updated_at: new Date(NOW - 20_000).toISOString() } },
    });
    expect(html).toContain("Arjun");
    expect(html).toContain("Live");
    expect(html).toContain("from you");
    expect(html).toContain("62 km/h");
    expect(html).toContain("1 sharing");
    expect(html).toContain("Sai");
    expect(html).toContain("Not sharing");
  });

  it("an old position is shown as last seen, not live", () => {
    const html = render({ members: { u2: { user_id: "u2", lat: 16.5, lng: 80.7, heading: null, speed_kmh: null, updated_at: new Date(NOW - 25 * 60_000).toISOString() } } });
    expect(html).toContain("Last seen 25 min ago");
  });

  it("shows permission/network errors as an alert", () => {
    expect(render({ error: "Location permission was denied." })).toContain('role="alert"');
  });

  it("no stops left: tells you what to do instead of showing nothing", () => {
    const html = render({ active: true, me: { lat: 16.5, lng: 80.6, heading: null, speedKmh: null, accuracyM: null, at: NOW, fixAt: NOW } }, { stops: [] });
    expect(html).toContain("No stops left on Day 1");
  });
});
