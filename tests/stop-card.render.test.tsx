import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StopCard } from "@/components/StopCard";
import { Menu, MenuItem } from "@/components/ui/Menu";
import type { Place } from "@/lib/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const place = (o: Partial<Place> = {}): Place => ({ id: "p1", trip_id: "t1", name: "Kolanupaka", lat: 17.6, lng: 79.0, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1, arrival_time: "11:50:00", notes: null, added_by: null, created_at: "", category: "temple", address: "Alair mandal, Yadadri Bhuvanagiri, Telangana", drive_minutes: 30, drive_km: 32, status: "planned", status_at: null, priority: null, visit_minutes: null, ...o } as Place);
const base = { status: "unknown" as const, category: "temple" as const, score: null, moveDays: [1, 2, 3] };
const handlers = { onMove: vi.fn(), onRemove: vi.fn(), onVote: vi.fn(), onRelocate: vi.fn(), onStatus: vi.fn() };
const html = (p: Place, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement("ol", null, createElement(StopCard, { place: p, ...base, ...handlers, ...extra } as never)));

describe("StopCard — a clear timeline card, not a pile of links", () => {
  it("shows the stop's name, address, time and the drive from the previous point", () => {
    const h = html(place());
    expect(h).toContain("Kolanupaka"); expect(h).toContain("Alair mandal"); expect(h).toContain("11:50"); expect(h).toContain("30 min · 32 km from previous point");
  });
  it("the two actions you use all the time are real buttons: Skip and Done", () => {
    const h = html(place());
    expect(h).toMatch(/<button[^>]*>[^]*?Skip/); expect(h).toMatch(/<button[^>]*>[^]*?Done/);
    expect(h).toContain('aria-label="Progress for Kolanupaka"');
  });
  it("everything occasional lives behind ONE menu button, so nothing shows as loose links", () => {
    const h = html(place());
    expect(h).toContain('aria-label="More actions for Kolanupaka"'); expect(h).toContain('aria-haspopup="menu"'); expect(h).toContain('aria-expanded="false"');
    for (const hidden of ["Wrong location?", "Remove from trip", "Move to"]) expect(h).not.toContain(hidden);
    expect(h).not.toMatch(/underline[^"]*">Remove/);
  });
  it("the open menu offers Move to (every other day and Ideas), Fix the pin, and a separate danger row to remove", () => {
    const h = html(place(), { menuOpen: true });
    expect(h).toContain('role="menu"'); expect(h).toContain("Move to");
    for (const d of ["Ideas", "Day 2", "Day 3"]) expect(h).toContain(d);
    expect(h).not.toMatch(/role="menuitem"[^>]*>Day 1</);                     // not the day it is already on
    expect(h).toContain("Wrong location? Fix the pin"); expect(h).toContain("Remove from trip"); expect(h).toContain('role="separator"');
  });
  it("a source link is a visible 'Original post' chip that opens safely in a new tab", () => {
    const h = html(place({ source_url: "https://example.com/post" }));
    expect(h).toContain("Original post"); expect(h).toContain('target="_blank"'); expect(h).toContain("noopener noreferrer nofollow"); expect(h).toContain("(opens in a new tab)");
    expect(html(place())).not.toContain("Original post");
  });
  it("votes are one segmented control with a state for assistive tech", () => {
    const h = html(place(), { votes: { up: 3, down: 1, score: 2, mine: 1 } });
    expect(h).toContain('aria-label="Group vote for Kolanupaka"'); expect(h).toContain('aria-pressed="true"'); expect(h).toContain('aria-pressed="false"');
  });
  it("buttons are big enough to tap on a phone (44 px)", () => {
    const h = html(place(), { votes: { up: 0, down: 0, score: 0, mine: 0 } });
    expect(h).toContain("min-h-11"); expect(h).toContain("max-sm:min-h-11");
  });
  it("a done stop shows a Done badge, a ticked marker and Undo instead of Skip/Done", () => {
    const h = html(place({ status: "done" }));
    expect(h).toContain("Done</span>"); expect(h).toContain("Undo"); expect(h).not.toMatch(/>Skip</);
  });
  it("a skipped stop says Skipped and offers Undo", () => {
    const h = html(place({ status: "skipped" }));
    expect(h).toContain("Skipped"); expect(h).toContain("Undo");
  });
  it("while a save is running the card says so, in a way screen readers announce", () => {
    const h = html(place(), { busy: true });
    expect(h).toContain("Saving…"); expect(h).toContain('role="status"');
    expect(html(place())).not.toContain("Saving…");
  });
  it("an idea (not on a day yet) has no timeline, no Done/Skip, and a clear 'Schedule on…' button", () => {
    const h = html(place({ day_number: null, arrival_time: null }));
    expect(h).toContain("Schedule on…"); expect(h).not.toContain("Done<span"); expect(h).not.toContain("from previous point"); expect(h).not.toContain("No time");
  });
  it("a stop without an arrival time says so, with a hint", () => {
    expect(html(place({ arrival_time: null }))).toContain("No time");
  });
  it("a far-away pin gets a proper callout that points to the menu", () => {
    const h = html(place(), { farWarning: { km: 312, anchorLabel: "Vizag" } });
    expect(h).toContain('role="note"'); expect(h).toContain("312 km from Vizag — is this pin right?"); expect(h).toContain("in the menu");
  });
  it("'Find alternatives' appears once, only when the timing is poor", () => {
    const poor = html(place(), { status: "wrong_season", onAlternatives: vi.fn() });
    expect(poor.match(/Find alternatives/g)?.length).toBe(1);
    expect(html(place(), { onAlternatives: vi.fn() })).not.toContain("Find alternatives");
  });
});

describe("Menu — keyboard, phone sheet and closing", () => {
  // The menu listens for clicks outside it; there is no real page in these tests, so give it a tiny stand-in.
  beforeEach(() => { vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined, activeElement: null }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  // (typed loosely: Menu takes a function as its child, which createElement's own typing does not model)
  const make = (props: Record<string, unknown>, child: (close: () => void) => unknown) => createElement(Menu as never, props as never, child as never);
  const menu = (open = false) => make({ label: "More", title: "Actions", defaultOpen: open }, (close) => createElement(MenuItem as never, { onSelect: close } as never, "First" as never));

  it("closed by default; open shows a labelled menu with a phone sheet backdrop and heading", () => {
    expect(renderToStaticMarkup(menu(false))).not.toContain('role="menu"');
    const h = renderToStaticMarkup(menu(true));
    expect(h).toContain('role="menu"'); expect(h).toContain('role="menuitem"'); expect(h).toContain("max-sm:fixed"); expect(h).toContain("max-sm:mb-[env(safe-area-inset-bottom)]"); expect(h).toContain("sm:hidden"); expect(h).toContain("Actions");
  });
  it("the button announces whether it is open", () => {
    expect(renderToStaticMarkup(menu(true))).toContain('aria-expanded="true"');
  });
  it("tapping the button opens it, and choosing an item closes it again", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(menu(false)); });
    expect(r.root.findAllByProps({ role: "menu" })).toHaveLength(0);
    act(() => { r.root.findByProps({ "aria-haspopup": "menu" }).props.onClick(); });
    expect(r.root.findAllByProps({ role: "menu" }).length).toBeGreaterThan(0);
    act(() => { r.root.findAllByProps({ role: "menuitem" })[0].props.onClick(); });
    expect(r.root.findAllByProps({ role: "menu" })).toHaveLength(0);
    act(() => r.unmount());
  });
  it("the page behind is not clickable through the sheet: tapping the dimmed area closes it", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(menu(true)); });
    act(() => { r.root.findByProps({ "aria-hidden": "true", className: "fixed inset-0 z-40 bg-pine/40 sm:hidden" }).props.onClick(); });
    expect(r.root.findAllByProps({ role: "menu" })).toHaveLength(0);
    act(() => r.unmount());
  });
  it("tells its owner when it opens and closes (so half-finished confirmations reset)", async () => {
    const seen: boolean[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(make({ label: "M", onOpenChange: (o: boolean) => seen.push(o) }, () => createElement(MenuItem as never, { onSelect: () => undefined } as never, "x" as never))); });
    await act(async () => { r.root.findByProps({ "aria-haspopup": "menu" }).props.onClick(); await Promise.resolve(); });
    await act(async () => { r.root.findByProps({ "aria-haspopup": "menu" }).props.onClick(); await Promise.resolve(); });
    expect(seen).toEqual([true, false]);
    act(() => r.unmount());
  });
});

describe("StopCard — linked to the map", () => {
  it("has a 'Show on the map' button with an accessible name, only when the planner provides one", () => {
    const h = html(place(), { onShowOnMap: vi.fn() });
    expect(h).toContain('aria-label="Show Kolanupaka on the map"');
    expect(html(place())).not.toContain("on the map\"");
  });
  it("has a stable id so the map can scroll to it, on the timeline and for ideas", () => {
    expect(html(place())).toContain('id="stop-p1"');
    expect(html(place({ day_number: null }))).toContain('id="stop-p1"');
  });
  it("the stop picked on the map is outlined", () => {
    expect(html(place(), { selected: true })).toContain("ring-2 ring-teal");
    expect(html(place())).not.toContain("ring-2 ring-teal");
  });
});
