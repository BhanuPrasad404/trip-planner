import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripDatesPanel } from "@/components/TripDatesPanel";

const noop = () => {};
const panel = (o: Partial<React.ComponentProps<typeof TripDatesPanel>> = {}) => renderToStaticMarkup(<TripDatesPanel tripId="t" startDate="2026-10-14" numDays={3} canEdit stopCountsByDay={{ 1: 2, 2: 2, 3: 1 }} onChanged={noop} {...o} />);

describe("TripDatesPanel", () => {
  it("shows the date range, the number of days, and what the dates are used for", () => {
    const h = panel();
    expect(h).toContain("Trip dates"); expect(h).toContain("14 Oct"); expect(h).toContain("16 Oct"); expect(h).toContain("3 days"); expect(h).toContain("worked out for these dates");
  });
  it("with no dates it says so and explains the consequence, with a clear 'Add dates' action", () => {
    const h = panel({ startDate: null });
    expect(h).toContain("No dates yet"); expect(h).toContain("not your trip"); expect(h).toContain("Add dates"); expect(h).not.toContain("Change dates");
  });
  it("the owner can edit; anyone else is told who can", () => {
    expect(panel()).toContain("Change dates");
    const m = panel({ canEdit: false });
    expect(m).not.toContain("Change dates"); expect(m).toContain("Only the trip owner can change the dates");
  });
  it("the editor is folded away until asked for", () => {
    const h = panel();
    expect(h).not.toContain('type="date"'); expect(h).not.toContain("How many days?");
  });
  it("a one-day trip says '1 day'", () => { expect(panel({ numDays: 1 })).toContain("1 day."); });
});
