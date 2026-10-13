import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DriveGateCard } from "@/components/DriveGateCard";
import { checkStart } from "@/lib/location/start-check";
import type { Drive } from "@/lib/client/use-drive";
import type { StartCheck } from "@/lib/location/start-check";

const base = { todayISO: "2026-10-12", quality: null, here: null, plannedStart: null };
const good = { grade: "good", usable: true, radiusM: 10, message: "" } as never;

describe("starting a drive on a trip with no dates", () => {
  it("is flagged (and a trip WITH dates is not)", () => {
    const none = checkStart({ ...base, trip: { start_date: null, num_days: 3 } });
    expect(none.issues).toEqual([{ kind: "no-dates" }]); expect(none.clear).toBe(false);
    expect(checkStart({ ...base, trip: { start_date: "2026-10-12", num_days: 3 }, quality: good }).issues.some((i) => i.kind === "no-dates")).toBe(false);
  });
  it("an impossible date counts as no date", () => {
    expect(checkStart({ ...base, trip: { start_date: "2026-02-31", num_days: 3 } }).issues).toEqual([{ kind: "no-dates" }]);
  });
  it("combines with the other questions (not in place of them)", () => {
    const c = checkStart({ ...base, trip: { start_date: null, num_days: 3 }, quality: { grade: "poor", usable: false, radiusM: 5000, message: "Rough" } as never, here: { lat: 17, lng: 80 }, plannedStart: { lat: 17.385, lng: 78.48, label: "Hyderabad" } });
    expect(c.issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["no-dates", "unsure-position"]));
  });
});

describe("the drive gate says it plainly, and lets the traveller choose", () => {
  const drive = { active: true, me: { lat: 17.385, lng: 78.48 }, quality: null, error: null, setManual: vi.fn(), stop: vi.fn() } as unknown as Drive;
  const gate = (check: StartCheck) => ({ tripId: "t-1", open: true, confirmed: false, check, confirm: vi.fn(), plannedStart: null, today: "2026-10-12", driveDay: 1 });
  const h = renderToStaticMarkup(<DriveGateCard drive={drive} gate={gate({ clear: false, issues: [{ kind: "no-dates" }], kmFromStart: null })} />);

  it("uses the prompt from the product brief and names what is limited", () => {
    expect(h).toContain("Your trip dates aren&#x27;t set yet. Set them to check destination opening hours, weather forecasts, estimated arrival times and travel conditions.");
    expect(h).toContain("limited checks");
  });
  it("offers real choices: continue with limited checks, set the dates, or not now — and never forces the dates", () => {
    expect(h).toContain("Continue with limited checks");
    expect(h).toContain('href="/trips/t-1/plan#dates-heading"'); expect(h).toContain("Set trip dates");
    expect(h).toContain("Not now");
  });
  it("when other questions are also open, the main button keeps its usual meaning", () => {
    const both = renderToStaticMarkup(<DriveGateCard drive={drive} gate={gate({ clear: false, issues: [{ kind: "no-dates" }, { kind: "late", plannedDate: "2026-10-01" }], kmFromStart: null })} />);
    expect(both).not.toContain("Continue with limited checks"); expect(both).toContain("Start now"); expect(both).toContain("Set trip dates");
  });
});
