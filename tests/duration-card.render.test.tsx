import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DurationCard } from "@/components/builder/TripBuilder";
import type { DurationAdvice } from "@/lib/trip-builder/duration";

const advice = (o: Partial<DurationAdvice> = {}): DurationAdvice => ({
  requestedDays: 3, places: 5, verdict: "could_be_shorter", suggestion: { key: "balanced", days: 2 },
  paces: [{ key: "compact", label: "Compact", blurb: "Long days", minDays: 1, comfortable: false, perDay: 5, longestDriveMin: 200 }, { key: "balanced", label: "Balanced", blurb: "Mix", minDays: 2, comfortable: true, perDay: 2.5, longestDriveMin: 120 }, { key: "relaxed", label: "Relaxed", blurb: "Slow", minDays: 2, comfortable: true, perDay: 2.5, longestDriveMin: 100 }],
  headline: "Your 5 places could fit in about 2 days at a balanced pace.", detail: "You planned 3 days.", assumptions: ["Driving times are typical speeds for a car (no live traffic)."], missing: ["Opening hours are unknown for 5 of 5 places, so closing times were not used."], ...o,
});
const html = (a: DurationAdvice, canEdit = true) => renderToStaticMarkup(<DurationCard a={a} canEdit={canEdit} busy={false} onChange={vi.fn()} />);

describe("DurationCard: the advice, never a decision", () => {
  it("states the finding, the three paces with days and places a day, and marks a pace that only just fits", () => {
    const h = html(advice());
    expect(h).toContain("could fit in about 2 days at a balanced pace"); expect(h).toContain("Compact"); expect(h).toContain("1 day"); expect(h).toContain("(only just)"); expect(h).toContain("2.5 places a day");
    expect(h).toContain('aria-label="Days needed at each pace"');
  });
  it("offers to change the trip only to shorter lengths, only to the owner, and says that nothing changes unless chosen", () => {
    const h = html(advice());
    expect(h).toContain("Plan 1 day (compact)"); expect(h).toContain("Plan 2 days (balanced)"); expect(h).not.toContain("Plan 3 days");
    expect(h).toContain("Or keep your 3 days. Nothing changes unless you choose.");
  });
  it("a member who is not the owner sees the advice but no buttons, and why", () => {
    const h = html(advice(), false);
    expect(h).not.toContain("Plan 2 days"); expect(h).toContain("Only the trip owner can change the trip length");
  });
  it("no change buttons when the trip is already the right length or too short", () => {
    expect(html(advice({ verdict: "about_right", suggestion: null }))).not.toContain("Plan 2 days");
    const more = html(advice({ verdict: "needs_more_days", suggestion: null, headline: "These 5 places probably need more than 1 day.", paces: advice().paces.map((p) => ({ ...p, minDays: p.key === "compact" ? 3 : null })) }));
    expect(more).not.toContain("Plan "); expect(more).toContain("Doesn&#x27;t fit");
  });
  it("is open about its assumptions and what it could not check", () => {
    const h = html(advice());
    expect(h).toContain("What this assumes and what it could not check (1)"); expect(h).toContain("no live traffic"); expect(h).toContain("Opening hours are unknown");
  });
  it("uses a tone that matches the finding", () => {
    expect(html(advice())).toContain("bg-teal-light/40"); expect(html(advice({ verdict: "tight", suggestion: null }))).toContain("bg-marigold-light/50"); expect(html(advice({ verdict: "needs_more_days", suggestion: null }))).toContain("bg-clay-light/50");
  });
});
