import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildNav } from "@/components/shell/nav";
import type { FeedItemDTO, MediaDTO } from "@/lib/feed/map";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }), usePathname: () => "/discover" }));
import { FeedCard, type CardProps } from "@/components/feed/FeedCard";
import { ModeBar, TripStrip } from "@/components/feed/FeedChrome";
import { MoreFromPlace } from "@/components/feed/MoreFromPlace";
import { PostDetail } from "@/components/feed/PostDetail";
import { PostMedia } from "@/components/feed/PostMedia";
import { ContextPanel } from "@/components/feed/ContextPanel";

const noop = () => undefined;
const photo = (n: number): MediaDTO => ({ type: "image", url: `https://signed.example/${n}.jpg`, posterUrl: null, width: 1080, height: 1350, durationS: null });
const item = (o: Partial<FeedItemDTO> = {}): FeedItemDTO => ({
  id: "22222222-2222-4222-8222-222222222222", kind: "photo", caption: "Trail after the rain", placeName: "Echo Point",
  destination: { id: "d1", name: "Matheran", slug: "matheran" }, author: { username: "ravi", displayName: null }, media: [photo(1), photo(2)],
  counts: { likes: 12, comments: 3, saves: 4, helpful: 5, tripAdds: 2 }, me: { liked: false, saved: false, helped: false },
  experience: { crowd: "quiet", conditions: ["road_good", "long_queue"], vibes: ["best_view"], tip: "Go before 9", fromArea: true },
  freshness: { label: "2 hours ago", state: "today", dot: "green", usableAsCurrent: true },
  location: { lat: 18.98, lng: 73.26, precision: "approx", distanceKm: 3.4 }, canComment: true, isMine: false, createdAt: "2026-10-10T10:00:00Z", ...o,
});
const card = (o: Partial<CardProps> = {}): CardProps => ({ item: item(), index: 3, active: false, near: false, frugal: false, muted: true, onTrip: false, register: noop, onToggleMute: noop, onLike: noop, onSave: noop, onComments: noop, onMenu: noop, onAddToTrip: noop, onHelpful: noop, onShare: noop, onDestination: noop, onVideoPlay: noop, onVideoProgress: noop, ...o });

describe("the card says what the place is like, and what to do about it", () => {
  it("shows the ground report, the planning actions and the way to the post", () => {
    const html = renderToStaticMarkup(<FeedCard {...card()} />);
    expect(html).toContain("Current · 2 hours ago"); expect(html).toContain("Quiet"); expect(html).toContain("Long queue"); expect(html).toContain("(take care)");
    expect(html).toContain("Go before 9"); expect(html).toContain("Added to 2 trips");
    expect(html).toContain('aria-label="Share"'); expect(html).toContain('aria-label="Open the post about Matheran"');
    expect(html).toContain('href="/discover/22222222-2222-4222-8222-222222222222"');
  });
  it("marks a post from a place on the trip, and only then", () => {
    expect(renderToStaticMarkup(<FeedCard {...card({ onTrip: true })} />)).toContain("On your trip");
    expect(renderToStaticMarkup(<FeedCard {...card()} />)).not.toContain("On your trip");
  });
  it("is one article in a feed, with its position, and the destination as its heading", () => {
    const html = renderToStaticMarkup(<FeedCard {...card({ index: 0 })} />);
    expect(html).toContain('aria-posinset="1"'); expect(html).toContain('aria-setsize="-1"'); expect(/<h2[^>]*>[\s\S]*Matheran/.test(html)).toBe(true);
  });
  it("never uses a fixed colour value (theme classes only), and no fixed screen heights", () => {
    const html = renderToStaticMarkup(<FeedCard {...card()} />);
    expect(/#[0-9a-fA-F]{3,8}[ "\]]/.test(html)).toBe(false);
    expect(html).not.toContain("calc(100dvh-11.5rem)");                                   // the old magic number that hid buttons behind the bottom bar
  });
});

describe("pictures", () => {
  it("photos: counter, previous/next for mouse users, labelled carousel, own shape", () => {
    const html = renderToStaticMarkup(<PostMedia item={item()} variant="card" muted onToggleMute={noop} />);
    expect(html).toContain("1/2"); expect(html).toContain('aria-label="Next photo"'); expect(html).toContain('aria-roledescription="carousel"'); expect(html).toContain("aspect-ratio:0.8");
  });
  it("a single photo has no carousel controls", () => {
    const html = renderToStaticMarkup(<PostMedia item={item({ media: [photo(1)] })} variant="card" muted onToggleMute={noop} />);
    expect(html).not.toContain("Next photo"); expect(html).not.toContain("carousel");
  });
  it("on the post page the whole picture shows (contain), in the feed it fills the frame (cover)", () => {
    expect(renderToStaticMarkup(<PostMedia item={item()} variant="page" muted onToggleMute={noop} />)).toContain("object-contain");
    expect(renderToStaticMarkup(<PostMedia item={item()} variant="card" muted onToggleMute={noop} />)).toContain("object-cover");
  });
  it("a written report is a text tile, not an empty frame", () => {
    const html = renderToStaticMarkup(<PostMedia item={item({ kind: "report", media: [], caption: "Road washed out at km 12" })} variant="card" muted onToggleMute={noop} />);
    expect(html).toContain("Road washed out at km 12");
  });
});

describe("the top of the feed", () => {
  it("modes are toggle buttons; My trip needs a trip", () => {
    const none = renderToStaticMarkup(<ModeBar intent="for_you" hasTrip={false} unread={0} onIntent={noop} onSaved={noop} onBell={noop} />);
    expect(none).toContain('aria-pressed="true"'); expect(none).not.toContain("My trip");
    const some = renderToStaticMarkup(<ModeBar intent="trip" hasTrip unread={12} onIntent={noop} onSaved={noop} onBell={noop} />);
    expect(some).toContain("My trip"); expect(some).toContain("9+"); expect(some).toContain("Notifications, 12 new");
    expect(some).toContain("top-0");                                                       // sticky
  });
  it("the trip strip offers the trip's posts, or a way to start a trip, or a choice between trips", () => {
    expect(renderToStaticMarkup(<TripStrip trips={[]} tripId={null} intent="for_you" onTrip={noop} onIntent={noop} />)).toContain("Plan a trip");
    const one = renderToStaticMarkup(<TripStrip trips={[{ id: "t1", name: "Monsoon weekend" }]} tripId="t1" intent="for_you" onTrip={noop} onIntent={noop} />);
    expect(one).toContain("Monsoon weekend"); expect(one).toContain("My trip posts"); expect(one).not.toContain('aria-haspopup="dialog"');
    const many = renderToStaticMarkup(<TripStrip trips={[{ id: "t1", name: "A" }, { id: "t2", name: "B" }]} tripId="t2" intent="trip" onTrip={noop} onIntent={noop} />);
    expect(many).not.toContain("<select");                                    // never the browser's own dropdown (unreadable on the phone theme)
    expect(many).toContain('aria-haspopup="dialog"'); expect(many).toContain(", change trip"); expect(many).toContain("Show all");
  });
});

describe("the post page", () => {
  const more = [item({ id: "33333333-3333-4333-8333-333333333333", placeName: "Louisa Point" })];
  const page = (o: Partial<FeedItemDTO> = {}, extra = more) => renderToStaticMarkup(<PostDetail initial={item(o)} more={extra} trips={[{ id: "t1", name: "Monsoon weekend" }]} focusTripId="t1" hasProfile />);
  it("has everything a planner needs on one page", () => {
    const html = page();
    expect(html).toContain("<h1"); expect(html).toContain("Matheran"); expect(html).toContain("Current · 2 hours ago");
    expect(html).toContain("Add to trip"); expect(html).toContain("Open map"); expect(html).toContain("Right now at Matheran");
    expect(html).toContain('id="comments"'); expect(html).toContain("Comments · 3"); expect(html).toContain("More from Matheran"); expect(html).toContain("Louisa Point");
    expect(html).toContain('aria-label="Share this post"'); expect(html).toContain(">Discover<");
  });
  it("more-from-place links each post to its own page", () => {
    expect(renderToStaticMarkup(<MoreFromPlace destination="Matheran" items={more} />)).toContain('href="/discover/33333333-3333-4333-8333-333333333333"');
    expect(renderToStaticMarkup(<MoreFromPlace destination="Matheran" items={[]} />)).toBe("");
  });
  it("on your own post it offers 'who liked this', and not the helpful mark", () => {
    const html = page({ isMine: true });
    expect(html).toContain("See who liked this (12)"); expect(html).not.toContain("This helped me decide");
  });
  it("an old post says so, in words, on the page too", () => {
    const html = page({ freshness: { label: "Historical — posted July 2026", state: "historical", dot: "grey", usableAsCurrent: false } }, []);
    expect(html).not.toContain("Current ·"); expect(html).toContain("Historical — posted July 2026");
  });
});

describe("large screens: the place beside the feed", () => {
  it("with nothing in view it says how it works; with a post in view it names the place and offers the trip", () => {
    expect(renderToStaticMarkup(<ContextPanel active={null} trip={null} enabled={false} onAddToTrip={noop} onShare={noop} />)).toContain("Scroll the feed");
    const html = renderToStaticMarkup(<ContextPanel active={item()} trip={{ id: "t1", name: "Monsoon weekend" }} enabled={false} onAddToTrip={noop} onShare={noop} />);
    expect(html).toContain("Right now at"); expect(html).toContain("Matheran"); expect(html).toContain("Add to trip"); expect(html).toContain('href="/trips/t1/plan"');
  });
});

describe("navigation", () => {
  it("Discover stays highlighted on a post's page", () => {
    const discover = (path: string) => buildNav(path, []).find((i) => i.id === "discover")!.match(path);
    expect(discover("/discover")).toBe(true); expect(discover("/discover/22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(discover("/discovery")).toBe(false); expect(discover("/trips")).toBe(false);
  });
});
