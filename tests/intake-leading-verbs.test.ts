// The phone showed "See Hampi: Not found" because the instant reader kept the action word ("See") as part of the place name
// (it starts with a capital, so the capital-letter rule let it through). The AI normally hid this; when it was slow, the bug was on screen.
import { describe, expect, it } from "vitest";
import { readTrip } from "@/lib/intake/read";

const names = (t: string) => readTrip(t, { todayMonth: 10 }).places.map((p) => p.said);

describe("place names: the action word in front is not part of the name", () => {
  it("'See Hampi' is Hampi", () => {
    expect(names("3 days from Hyderabad, See Hampi")).toContain("Hampi");
    expect(names("3 days from Hyderabad, See Hampi")).not.toContain("See Hampi");
  });
  it("visit / explore / go to / near", () => {
    expect(names("Visit Lepakshi Temple, Explore Gandikota")).toEqual(expect.arrayContaining(["Lepakshi Temple", "Gandikota"]));
    expect(names("Go to Goa")).toContain("Goa");
    expect(names("Near Araku")).toContain("Araku");
  });
  it("a real name is never cut: 'Old Goa', 'Hampi', and a place literally called Visakhapatnam", () => {
    expect(names("Explore Old Goa")).toContain("Old Goa");
    expect(names("Hampi, Gandikota")).toEqual(expect.arrayContaining(["Hampi", "Gandikota"]));
    expect(names("Visakhapatnam")).toContain("Visakhapatnam");
  });
  it("a lone action word is not turned into an empty name or crash", () => {
    expect(() => names("See")).not.toThrow();
    expect(names("See")).not.toContain("");
  });
});
