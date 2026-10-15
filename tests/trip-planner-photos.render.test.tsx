import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { PlacePhoto } from "@/lib/place-photos";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/client/use-trip-realtime", () => ({ useTripRealtime: vi.fn() }));

const photo: PlacePhoto = {
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fort.jpg/330px-Fort.jpg", width: 500, height: 300, title: "Fort", source: "wikipedia",
  pageUrl: "https://en.wikipedia.org/wiki/Fort", creditUrl: "https://commons.wikimedia.org/wiki/File:Fort.jpg", author: "Jane Doe", licence: "CC BY-SA 4.0",
};
const asked: { key: string; name: string }[][] = [];
vi.mock("@/lib/client/use-place-photos", () => ({
  usePlacePhotos: (q: { key: string; name: string }[]) => { asked.push(q); return q.some((p) => p.key === "with-photo") ? { "with-photo": photo } : {}; },
}));

import { TripPlanner } from "@/components/TripPlanner";

const trip: Trip = { id: "00000000-0000-0000-0000-000000000001", owner_id: "u1", name: "T", start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: null, dest_lat: null, dest_lng: null, start_date: "2026-10-01", num_days: 2, invite_code: "abc", created_at: "" };
const place = (id: string, name: string, extra: Partial<PlaceWithSeason> = {}): PlaceWithSeason => ({
  id, trip_id: trip.id, name, lat: 17.4, lng: 78.5, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1,
  arrival_time: "09:00:00", notes: null, category: "fort", address: null, status: "planned", status_at: null, drive_minutes: null, drive_km: null, added_by: null, created_at: "", season_tags: null, ...extra,
});
const members: TripMember[] = [{ id: "m1", trip_id: trip.id, user_id: "u1", role: "owner", display_name: "Me", avatar_color: "#0b3d3a", joined_at: "" } as unknown as TripMember];
const html = (places: PlaceWithSeason[]) => renderToStaticMarkup(<TripPlanner trip={trip} places={places} members={members} today="2026-10-06" siteUrl="https://x" conditions={{}} userId="u1" votes={{}} />);

describe("Plan page → real photos on stop cards", () => {
  const places = [place("with-photo", "Bhongir Fort"), place("no-photo", "NTR Statue", { sequence_order: 2 }), place("idea-1", "Kolanupaka", { day_number: null, sequence_order: 0 })];

  it("looks up every stop on the plan (scheduled stops AND ideas), once, with its id as the key", () => {
    asked.length = 0;
    html(places);
    expect(asked[0].map((p) => p.key).sort()).toEqual(["idea-1", "no-photo", "with-photo"]);
    expect(asked[0].find((p) => p.key === "with-photo")?.name).toBe("Bhongir Fort");
  });
  it("shows the photo (with credit) only on the stop that has one", () => {
    const h = html(places);
    expect(h.match(/<img /g)).toHaveLength(1);
    expect(h).toContain('alt="Photo of Bhongir Fort"');
    expect(h).toContain("Photo: Jane Doe, CC BY-SA 4.0");
    expect(h).not.toContain('alt="Photo of NTR Statue"');
  });
});
