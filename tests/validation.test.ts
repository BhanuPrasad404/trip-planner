import { describe, expect, it } from "vitest";
import { createPlaceSchema, createTripSchema } from "@/lib/validation/schemas";
import { safeNextPath } from "@/lib/safe-redirect";

const DEMO_TRIP = "00000000-0000-0000-0000-000000000001"; // non-RFC uuid used by the seed

describe("createPlaceSchema", () => {
  const ok = { trip_id: DEMO_TRIP, name: "Kalu Waterfall", lat: 18.76, lng: 73.41, day_number: 3 };

  it("accepts a valid place (including the seeded demo trip id)", () => {
    expect(createPlaceSchema.safeParse(ok).success).toBe(true);
  });
  it("trims names and normalises empty optional fields to null", () => {
    const r = createPlaceSchema.parse({ ...ok, name: "  Rajmachi  ", source_url: "", arrival_time: "" });
    expect(r.name).toBe("Rajmachi");
    expect(r.source_url).toBeNull();
    expect(r.arrival_time).toBeNull();
  });
  it.each([
    ["latitude out of range", { lat: 91 }],
    ["longitude out of range", { lng: -181 }],
    ["NaN latitude", { lat: NaN }],
    ["empty name", { name: "   " }],
    ["day 0", { day_number: 0 }],
    ["fractional day", { day_number: 1.5 }],
    ["javascript: link", { source_url: "javascript:alert(1)" }],
    ["bad time", { arrival_time: "25:99" }],
    ["bad trip id", { trip_id: "../../etc" }],
  ])("rejects %s", (_label, patch) => {
    expect(createPlaceSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe("createTripSchema", () => {
  it("accepts a minimal trip", () => {
    expect(createTripSchema.safeParse({ name: "Goa", num_days: 3 }).success).toBe(true);
  });
  it("rejects 0 / 31 days, blank name, and bad dates", () => {
    expect(createTripSchema.safeParse({ name: "Goa", num_days: 0 }).success).toBe(false);
    expect(createTripSchema.safeParse({ name: "Goa", num_days: 31 }).success).toBe(false);
    expect(createTripSchema.safeParse({ name: " ", num_days: 3 }).success).toBe(false);
    expect(createTripSchema.safeParse({ name: "Goa", num_days: 3, start_date: "tomorrow" }).success).toBe(false);
  });
  it("does not let clients smuggle in owner_id or invite_code", () => {
    const r = createTripSchema.parse({ name: "Goa", num_days: 3, owner_id: "x", invite_code: "y" });
    expect(r).not.toHaveProperty("owner_id");
    expect(r).not.toHaveProperty("invite_code");
  });
});

describe("safeNextPath (open-redirect protection)", () => {
  it("allows normal in-app paths", () => {
    expect(safeNextPath("/trip/abc?x=1")).toBe("/trip/abc?x=1");
  });
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", "/a\r\nSet-Cookie: x=1"])(
    "blocks %j",
    (bad) => expect(safeNextPath(bad)).toBe("/trips")
  );
  it("falls back for empty values", () => {
    expect(safeNextPath(null)).toBe("/trips");
    expect(safeNextPath("")).toBe("/trips");
  });
});
