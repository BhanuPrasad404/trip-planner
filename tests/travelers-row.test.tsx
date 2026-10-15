import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TravelersRow, showTravelers, type Traveler } from "@/components/TravelersRow";

const one: Traveler = { id: "a", display_name: "Gita", avatar_color: "#1C7C6D" };
const two: Traveler = { id: "b", display_name: "Ravi", avatar_color: "#C1542C" };

describe("TravelersRow: the group's initials, only when there is a group", () => {
  it("renders nothing on a solo trip (one lone initial only used up a line of the phone header)", () => {
    expect(renderToStaticMarkup(<TravelersRow members={[one]} />)).toBe("");
    expect(showTravelers([one])).toBe(false);
  });
  it("renders nothing when the member list is empty", () => { expect(renderToStaticMarkup(<TravelersRow members={[]} />)).toBe(""); });
  it("shows each traveller once the trip has two or more, with a screen-reader name and a count", () => {
    const h = renderToStaticMarkup(<TravelersRow members={[one, two]} />);
    expect(h).toContain('aria-label="Travelers (2)"');
    expect(h.match(/<li/g)?.length).toBe(2);
    expect(h).toContain("Gita"); expect(h).toContain("Ravi");
  });
  it("falls back to '?' and 'Traveler' for a member with no name", () => {
    const h = renderToStaticMarkup(<TravelersRow members={[one, { id: "c", display_name: null, avatar_color: null }]} />);
    expect(h).toContain(">?<"); expect(h).toContain("Traveler");
  });
});
