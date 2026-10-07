import { describe, expect, it } from "vitest";
import { summarizeVotes } from "@/lib/votes";
import { buildItineraryText } from "@/lib/share-text";

describe("summarizeVotes", () => {
  const rows = [
    { place_id: "a", user_id: "me", vote: 1 as const },
    { place_id: "a", user_id: "u2", vote: 1 as const },
    { place_id: "a", user_id: "u3", vote: -1 as const },
    { place_id: "b", user_id: "u2", vote: -1 as const },
  ];
  it("counts up/down, nets them, and reports MY vote separately", () => {
    const s = summarizeVotes(rows, "me");
    expect(s.a).toEqual({ up: 2, down: 1, score: 1, mine: 1 });
    expect(s.b).toEqual({ up: 0, down: 1, score: -1, mine: 0 });
  });
  it("places nobody voted on simply have no entry", () => {
    expect(summarizeVotes([], "me")).toEqual({});
  });
  it("ignores malformed vote values", () => {
    const s = summarizeVotes([{ place_id: "a", user_id: "me", vote: 0 as unknown as 1 }], "me");
    expect(s.a).toMatchObject({ up: 0, down: 0, score: 0, mine: 0 });
  });
});

describe("buildItineraryText", () => {
  const trip = { name: "Weekend", start_city: "Hyderabad", dest_name: "Vijayawada", start_date: "2026-10-08", num_days: 2 };
  const base = { category: "fort", drive_km: null, drive_minutes: null, sequence_order: 1, arrival_time: null };
  const places = [
    { ...base, id: "1", name: "Kondapalli Fort", day_number: 1, arrival_time: "09:30:00", drive_minutes: 270, drive_km: 275 },
    { ...base, id: "2", name: "Bhavani Island", day_number: 1, sequence_order: 2, category: "lake" },
    { ...base, id: "3", name: "Undavalli Caves", day_number: 2, category: "museum" },
    { ...base, id: "4", name: "Idea Place", day_number: null },
  ];

  it("builds a day-by-day message with route, dates, times, drive legs and flags", () => {
    const t = buildItineraryText({ trip, places, flags: { "2": "⚠ check timing" }, link: "https://x.test/join/abc" });
    expect(t).toContain("🧭 *Hyderabad → Vijayawada* — 2 days");
    expect(t).toContain("*Day 1 · Thu, 8 Oct*");
    expect(t).toContain("🚗 4 h 30 min · 275 km");
    expect(t).toContain("09:30 — 🏰 Kondapalli Fort");
    expect(t).toContain("Bhavani Island  ⚠ check timing");
    expect(t).toContain("*Day 2");
    expect(t).toContain("💡 *Still to schedule:* Idea Place");
    expect(t).toContain("https://x.test/join/abc");
  });
  it("orders stops within a day by sequence, not input order", () => {
    const t = buildItineraryText({ trip, places: [places[1], places[0]] });
    expect(t.indexOf("Kondapalli Fort")).toBeLessThan(t.indexOf("Bhavani Island"));
  });
  it("works with no dates, no destination and no places", () => {
    const t = buildItineraryText({ trip: { name: "Goa", start_city: null, dest_name: null, start_date: null, num_days: 1 }, places: [] });
    expect(t).toBe("🧭 *Goa* — 1 day");
  });
});
