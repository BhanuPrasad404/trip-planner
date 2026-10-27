import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedItemDTO } from "@/lib/feed/map";
import type { Standing } from "@/lib/social/standing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }), usePathname: () => "/discover" }));
import { FeedCard, type CardProps } from "@/components/feed/FeedCard";
import { FollowButton, TravelerProfile } from "@/components/feed/TravelerProfile";
import { BadgeMark, BadgePills, Crest, StandingCard } from "@/components/feed/TravelerBadge";
import { QuickReport } from "@/components/feed/QuickReport";

const noop = () => undefined;
const item = (o: Partial<FeedItemDTO> = {}): FeedItemDTO => ({
  id: "22222222-2222-4222-8222-222222222222", kind: "photo", caption: "c", placeName: "Echo Point", destination: { id: "d1", name: "Matheran", slug: "m" },
  author: { username: "ravi", displayName: null }, media: [{ type: "image", url: "https://s/1.jpg", posterUrl: null, width: 1080, height: 1350, durationS: null }],
  counts: { likes: 1, comments: 0, saves: 0, helpful: 0, tripAdds: 0 }, me: { liked: false, saved: false, helped: false },
  experience: { crowd: null, conditions: [], vibes: [], tip: null, fromArea: false }, freshness: { label: "now", state: "fresh", dot: "green", usableAsCurrent: true },
  location: { lat: 1, lng: 2, precision: "exact", distanceKm: null }, canComment: true, isMine: false, createdAt: "2026-10-10T10:00:00Z", ...o,
});
const card = (o: Partial<CardProps> = {}): CardProps => ({ item: item(), index: 0, active: false, near: false, frugal: false, muted: true, onTrip: false, register: noop, onToggleMute: noop, onLike: noop, onSave: noop, onComments: noop, onMenu: noop, onAddToTrip: noop, onHelpful: noop, onShare: noop, onDestination: noop, onVideoPlay: noop, onVideoProgress: noop, ...o });
const standing = (o: Partial<Standing> = {}): Standing => ({ helped: 30, posts: 12, followers: 140, following: 20, tier: "trusted", place: { id: "d", name: "Araku Valley", helped: 9 }, ...o });

describe("badges on screen", () => {
  it("a card shows the crest beside the name, with its meaning in words for screen readers, and links to the traveler", () => {
    const html = renderToStaticMarkup(<FeedCard {...card({ item: item({ author: { username: "ravi", displayName: null, badge: { tier: "trusted", place: "Araku Valley", helped: 30 } } }) })} />);
    expect(html).toContain("Trusted traveler, Local voice: Araku Valley"); expect(html).toContain('href="/discover/u/ravi"');
  });
  it("no badge: nothing at all, not an empty crest", () => {
    expect(renderToStaticMarkup(<BadgeMark badge={null} />)).toBe("");
    expect(renderToStaticMarkup(<BadgePills badge={{ tier: null, place: null, helped: 2 }} />)).toBe("");
  });
  it("each level has its own shape (more star points), not only its own colour", () => {
    const pts = (t: "helpful" | "legend") => (renderToStaticMarkup(<Crest tier={t} />).match(/points="([^"]+)"/)![1].split(" ").length);
    expect(pts("helpful")).toBe(8); expect(pts("legend")).toBe(16);
  });
  it("your own card shows how close the next badge is; someone else's does not", () => {
    const mine = renderToStaticMarkup(<StandingCard helped={15} tier="helpful" place={null} mine />);
    expect(mine).toContain("Next: Trusted traveler"); expect(mine).toContain("10 more travelers"); expect(mine).toContain('role="progressbar"'); expect(mine).toContain("Each person counts once");
    expect(renderToStaticMarkup(<StandingCard helped={15} tier="helpful" place={null} mine={false} />)).not.toContain("Next:");
    expect(renderToStaticMarkup(<StandingCard helped={0} tier={null} place={null} mine />)).toContain("No badge yet");
  });
});

describe("a traveler's page", () => {
  const page = (o: object = {}) => renderToStaticMarkup(<TravelerProfile profile={{ username: "ravi", displayName: "Ravi K", bio: "Weekend rider", isPrivate: false, mine: false }} standing={standing()} follow="none" posts={[item()]} nextCursor="c" postsHidden={false} {...o} />);
  it("shows who they are, their numbers, their badge, their posts and a Follow button", () => {
    const html = page();
    expect(html).toContain("Ravi K"); expect(html).toContain("@ravi"); expect(html).toContain("Weekend rider");
    expect(html).toContain(">140<"); expect(html).toContain("followers"); expect(html).toContain(">30<"); expect(html).toContain("helped");
    expect(html).toContain("Trusted traveler"); expect(html).toContain("Local voice: Araku Valley");
    expect(html).toContain(">Follow<"); expect(html).toContain("Show more"); expect(html).toContain('href="/discover/22222222-2222-4222-8222-222222222222"');
  });
  it("hidden follow lists: the numbers simply aren't there", () => {
    const html = page({ standing: standing({ followers: null, following: null }) });
    expect(html).not.toContain("followers"); expect(html).not.toContain("following");
  });
  it("your own page offers Edit, not Follow", () => {
    const html = page({ profile: { username: "ravi", displayName: null, bio: null, isPrivate: false, mine: true } });
    expect(html).toContain("Edit profile"); expect(html).not.toContain(">Follow<"); expect(html).toContain("Your posts");
  });
  it("a private traveler's posts explain themselves instead of looking empty", () => {
    expect(page({ posts: [], postsHidden: true, nextCursor: null })).toContain("shares posts with followers only");
  });
});

describe("Follow button", () => {
  const fetches: { url: string; method: string }[] = [];
  afterEach(() => { vi.unstubAllGlobals(); fetches.length = 0; });
  const mount = async (initial: "none" | "following" | "pending", answer: { status: number; body: unknown }) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { fetches.push({ url, method: init?.method ?? "GET" }); return new Response(JSON.stringify(answer.body), { status: answer.status }); }));
    const changes: string[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(FollowButton, { username: "ravi", initial, onChange: (s) => changes.push(s) })); });
    const press = async () => { await act(async () => { r.root.findByType("button").props.onClick(); }); };
    const label = () => (r.root.findByType("button").children[0] as string);
    return { r, press, label, changes };
  };
  it("follows, and a private traveler becomes 'Requested'", async () => {
    const b = await mount("none", { status: 201, body: { ok: true, status: "pending" } });
    await b.press();
    expect(fetches[0]).toEqual({ url: "/api/follows", method: "POST" }); expect(b.label()).toBe("Requested");
  });
  it("unfollows", async () => {
    const b = await mount("following", { status: 200, body: { ok: true } });
    await b.press();
    expect(fetches[0]).toEqual({ url: "/api/follows?username=ravi", method: "DELETE" }); expect(b.label()).toBe("Follow");
  });
  it("when the server says no, it goes back and says why", async () => {
    const b = await mount("none", { status: 429, body: { error: "Too many follows today" } });
    await b.press();
    expect(b.label()).toBe("Follow"); expect(b.changes).toEqual(["following", "none"]);
    expect(JSON.stringify(b.r.toJSON())).toContain("Too many follows today");
  });
  it("without a profile it points to setting one up", async () => {
    const b = await mount("none", { status: 409, body: { error: "Set up your traveler profile first" } });
    await b.press();
    expect(JSON.stringify(b.r.toJSON())).toContain("Open profile"); expect(b.label()).toBe("Follow");
  });
});

describe("'How was it?' sheet", () => {
  it("asks with one-tap choices, says nothing is posted yet, and can't be sent empty", () => {
    const html = renderToStaticMarkup(<QuickReport place={{ name: "Echo Point", lat: 18.98, lng: 73.26 }} onClose={noop} />);
    expect(html).toContain("How was Echo Point?"); expect(html).toContain("Nothing is posted until you press Share");
    expect(html).toContain("Quiet"); expect(html).toContain("Parking full"); expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Share<\/button>/); expect(html).toContain("Tap one thing, or write a few words.");
    expect(html).toContain("Not now"); expect(html).toContain("Don&#x27;t ask me after stops"); expect(html).toContain('for="quick-note"');
  });
});
