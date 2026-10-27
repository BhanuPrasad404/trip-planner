import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedItemDTO } from "@/lib/feed/map";
import { rowToCandidate, toItem, type FeedRow } from "@/lib/feed/map";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }));
import { FeedCard, type CardProps } from "@/components/feed/FeedCard";
import { FollowButton } from "@/components/feed/TravelerProfile";
import { TripList } from "@/components/feed/TripPicker";

const noop = () => undefined;
const item = (o: Partial<FeedItemDTO> = {}): FeedItemDTO => ({
  id: "22222222-2222-4222-8222-222222222222", kind: "photo", caption: "c", placeName: "Spot", destination: { id: "d1", name: "Matheran", slug: "m" },
  author: { username: "ravi", displayName: null, followed: false }, media: [{ type: "image", url: "https://s/1.jpg", posterUrl: null, width: 10, height: 10, durationS: null }],
  counts: { likes: 0, comments: 0, saves: 0, helpful: 0, tripAdds: 0 }, me: { liked: false, saved: false, helped: false }, experience: { crowd: null, conditions: [], vibes: [], tip: null, fromArea: false },
  freshness: { label: "now", state: "fresh", dot: "green", usableAsCurrent: true }, location: { lat: 1, lng: 2, precision: "exact", distanceKm: null }, canComment: true, isMine: false, createdAt: "2026-10-10T10:00:00Z", ...o,
});
const card = (o: Partial<CardProps> = {}): CardProps => ({ item: item(), index: 0, active: false, near: false, frugal: false, muted: true, onTrip: false, register: noop, onToggleMute: noop, onLike: noop, onSave: noop, onComments: noop, onMenu: noop, onAddToTrip: noop, onHelpful: noop, onShare: noop, onDestination: noop, onVideoPlay: noop, onVideoProgress: noop, onFollow: noop, onNotice: noop, ...o });

describe("Follow on every post", () => {
  it("shows Follow, or Following when you already follow them", () => {
    expect(renderToStaticMarkup(<FeedCard {...card()} />)).toMatch(/aria-pressed="false"[^>]*>Follow</);
    expect(renderToStaticMarkup(<FeedCard {...card({ item: item({ author: { username: "ravi", displayName: null, followed: true } }) })} />)).toMatch(/aria-pressed="true"[^>]*>Following</);
  });
  it("never on your own post", () => {
    expect(renderToStaticMarkup(<FeedCard {...card({ item: item({ isMine: true }) })} />)).not.toContain(">Follow<");
  });
  it("the feed knows who you follow (from the database row)", () => {
    const row = { id: "22222222-2222-4222-8222-222222222222", author_id: "a", username: "ravi", display_name: null, destination_id: "d", destination_name: "M", destination_slug: "m", destination_posts: 1, kind: "photo", caption: null, place_name: "S", lat: 1, lng: 2, location_precision: "exact", captured_at: "2026-10-10T10:00:00Z", created_at: "2026-10-10T10:00:00Z", comments_allowed: "everyone", duration_s: null, crowd: null, conditions: [], vibes: [], tip: null, verified_area: false, likes: 0, comments: 0, saves: 0, shares: 0, helpful: 0, trip_adds: 0, impressions: 0, plays: 0, completions: 0, skips: 0, watch_ms: 0, followed: true, liked: false, saved: false, helped: false, seen_at: null, seen_pct: null } as FeedRow;
    expect(toItem(rowToCandidate(row)!, [], { now: new Date("2026-10-11T00:00:00Z"), viewerId: "me", position: null }).author.followed).toBe(true);
  });
});

describe("the small Follow chip", () => {
  afterEach(() => vi.unstubAllGlobals());
  const mount = async (status: number, body: unknown) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
    const changes: string[] = []; const errors: string[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(FollowButton, { username: "ravi", initial: "none", compact: true, onChange: (s) => changes.push(s), onError: (t) => errors.push(t) })); });
    await act(async () => { r.root.findByType("button").props.onClick(); });
    return { changes, errors, r };
  };
  it("tells the feed at once, so every post by this traveler updates", async () => {
    const { changes } = await mount(201, { ok: true, status: "accepted" });
    expect(changes).toEqual(["following"]);
  });
  it("a refusal goes back AND is said as a message (a card has no room for a line under the chip)", async () => {
    const { changes, errors, r } = await mount(429, { error: "Too many follows today" });
    expect(changes).toEqual(["following", "none"]); expect(errors).toEqual(["Too many follows today"]);
    expect(JSON.stringify(r.toJSON())).not.toContain("Too many follows today");
  });
  it("no profile yet: the message offers the way to make one", async () => {
    let link: unknown = null;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(FollowButton, { username: "ravi", initial: "none", compact: true, onError: (_t, l) => { link = l; } })); });
    await act(async () => { r.root.findByType("button").props.onClick(); });
    expect(link).toEqual({ label: "Open profile", href: "/profile" });
  });
});

describe("trip picker", () => {
  it("is a real radio group: one choice ticked, every trip readable", () => {
    const html = renderToStaticMarkup(<TripList trips={[{ id: "a", name: "sdvdf" }, { id: "b", name: "vizag" }]} value="b" onPick={noop} />);
    expect(html).toContain('role="radiogroup"'); expect((html.match(/role="radio"/g) ?? []).length).toBe(2);
    expect(/aria-checked="true"[^>]*>[\s\S]*vizag/.test(html)).toBe(true); expect(html).toContain("sdvdf");
    expect(html).not.toContain("<select"); expect(html).not.toContain("<option");
  });
  it("picking a trip reports it", async () => {
    const picked: string[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(TripList, { trips: [{ id: "a", name: "A" }, { id: "b", name: "B" }], value: "a", onPick: (id) => picked.push(id) })); });
    await act(async () => { r.root.findAll((n) => n.props.role === "radio")[1].props.onClick(); });
    expect(picked).toEqual(["b"]);
  });
});
