// Phone screenshots (393 px wide, big text): the name broke as "Visakhapatna / m", "Morning Afternoon Evening" ran together in four
// narrow boxes, "No updates from the last 30 days." wrapped one word per line beside its button, and Skip / Done were small and loose.
// These pin the layout rules that fix each of them.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StopCard } from "@/components/StopCard";
import { PlaceReports } from "@/components/PlaceReports";
import { DayStrip } from "@/components/weather/WeatherParts";
import type { DayPart } from "@/lib/forecast/day-parts";
import type { Place } from "@/lib/types";

const place = (o: Partial<Place> = {}): Place => ({ id: "p1", trip_id: "t1", name: "Visakhapatnam", lat: 17.7, lng: 83.2, source_type: "manual", source_url: null, season_tag_id: null, day_number: 2, sequence_order: 1, arrival_time: "08:30:00", notes: null, added_by: null, created_at: "", category: "city", address: "Andhra Pradesh", drive_minutes: 0, drive_km: 0, status: "planned", status_at: null, priority: null, visit_minutes: null, ...o } as Place);
const base = { status: "unknown" as const, category: "temple" as const, score: null, moveDays: [1, 2, 3] };
const html = (p: Place, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement("ol", null, createElement(StopCard, { place: p, ...base, onStatus: vi.fn(), onMove: vi.fn(), onShowOnMap: vi.fn(), ...extra } as never)));

describe("a long place name", () => {
  it("is allowed to hyphenate and wrap (never cut with no hyphen in the middle of a word)", () => {
    const h = html(place());
    expect(h).toMatch(/<h3 lang="en" class="[^"]*break-words[^"]*\[hyphens:auto\]/);
  });
  it("the timeline gutter is narrower on a phone so the card gets the width", () => {
    expect(html(place())).toContain("grid-cols-[2.75rem_minmax(0,1fr)]");
  });
});

describe("Skip and Done", () => {
  it("share the row on a phone (equal tap targets, Done a little wider), with Map beside them, and never wrap onto a second line", () => {
    const h = html(place());
    const row = /role="group" aria-label="Progress for Visakhapatnam"([^>]*)>/.exec(h)![0];
    expect(row).not.toContain("flex-wrap");
    expect(h).toMatch(/class="[^"]*min-h-11 flex-1[^"]*"[^>]*>[\s\S]*?Skip/);
    expect(h).toMatch(/class="[^"]*min-h-11 flex-\[1\.4\][^"]*"[^>]*>[\s\S]*?Done/);
    expect(h).toMatch(/shrink-0[^>]*sm:hidden[^>]*>[\s\S]*?Map<span/);
  });
});

const parts: DayPart[] = (["morning", "afternoon", "evening", "night"] as const).map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), past: false, coverage: "full", hours: [] }) as unknown as DayPart);
describe("the day strip (Morning / Afternoon / Evening / Night)", () => {
  it("is two columns on a phone and four from the small breakpoint up, with every cell able to shrink and wrap", () => {
    const h = renderToStaticMarkup(createElement(DayStrip, { parts, highlight: "morning", label: "x" }));
    expect(h).toContain("grid-cols-2");
    expect(h).toContain("sm:grid-cols-4");
    expect(h).not.toMatch(/class="grid grid-cols-4/);
    expect((h.match(/min-w-0/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(h).toContain("break-words");
  });
});

describe("the traveller reports line", () => {
  it("puts the text above a full-width button on a phone, side by side only when there is room", () => {
    const h = renderToStaticMarkup(createElement(PlaceReports, { place: { id: "p1", name: "Visakhapatnam", lat: 17.7, lng: 83.2 }, reports: [], userId: "u1", now: new Date(), onChanged: vi.fn() } as never));
    expect(h).toContain("flex-col");
    expect(h).toContain("min-[420px]:flex-row");
    expect(h).toMatch(/w-full[^"]*min-\[420px\]:w-auto/);
    expect(h).toContain("No updates from the last 30 days.");
  });
});
