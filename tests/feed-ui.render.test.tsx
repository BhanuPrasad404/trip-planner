import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedCard, type CardProps } from "@/components/feed/FeedCard";
import { FeedView } from "@/components/feed/FeedView";
import { AddToTripSheet } from "@/components/feed/AddToTripSheet";
import type { FeedItemDTO, MediaDTO } from "@/lib/feed/map";

const noop = () => undefined;
const item = (o: Partial<FeedItemDTO> = {}): FeedItemDTO => ({
  id: "22222222-2222-4222-8222-222222222222", kind: "photo", caption: "Trail after the rain", placeName: "Echo Point",
  destination: { id: "d1", name: "Matheran", slug: "matheran" }, author: { username: "ravi", displayName: null }, media: [],
  counts: { likes: 12, comments: 3, saves: 4, helpful: 0, tripAdds: 0 }, me: { liked: false, saved: false, helped: false }, experience: { crowd: null, conditions: [], vibes: [], tip: null, fromArea: false },
  freshness: { label: "2 hours ago", state: "today", dot: "green", usableAsCurrent: true },
  location: { lat: 18.98, lng: 73.26, precision: "approx", distanceKm: 3.4 }, canComment: true, isMine: false, createdAt: "2026-10-10T10:00:00Z", ...o,
});
const props = (o: Partial<CardProps> = {}): CardProps => ({
  item: item(), index: 3, active: false, near: false, frugal: false, muted: true, register: noop, onToggleMute: noop, onLike: noop, onSave: noop,
  onComments: noop, onMenu: noop, onAddToTrip: noop, onHelpful: noop, onDestination: noop, onVideoPlay: noop, onVideoProgress: noop, ...o,
});
const video: MediaDTO = { type: "video", url: "https://signed.example/v.mp4", posterUrl: "https://signed.example/p.jpg", width: 720, height: 1280, durationS: 18 };
const photo = (n: number): MediaDTO => ({ type: "image", url: `https://signed.example/${n}.jpg`, posterUrl: null, width: 1080, height: 1350, durationS: null });

describe("FeedCard: travel context first", () => {
  it("leads with destination, spot, distance and honest freshness", () => {
    const html = renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)] }) })} />);
    expect(html).toContain("Matheran");
    expect(html).toContain("Echo Point");
    expect(html).toContain("3.4 km away");
    expect(html).toContain("approximate area");
    expect(html).toContain("Current · 2 hours ago");
    expect(html).toContain("Add to trip");
    expect(html).toContain("Open map");
  });
  it("never calls an old post 'current'", () => {
    const html = renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)], freshness: { label: "Historical — posted July 2026", state: "historical", dot: "grey", usableAsCurrent: false } }) })} />);
    expect(html).toContain("Historical — posted July 2026");
    expect(html).not.toContain("Current ·");
  });
  it("actions are real buttons with names and pressed state, and show counts", () => {
    const html = renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)], me: { liked: true, saved: false, helped: false } }) })} />);
    expect(html).toContain('aria-label="Remove like"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Save"');
    expect(html).toContain('aria-label="Comments (3)"');
    expect(html).toContain(">12<");
  });
  it("a written report with no media still reads as a post", () => {
    const html = renderToStaticMarkup(<FeedCard {...props({ item: item({ kind: "report", caption: "Road clear, parking full" }) })} />);
    expect(html).toContain("Road clear, parking full");
    expect(html).toContain("condition report");
  });
});

describe("FeedCard: images", () => {
  it("sets width/height (no layout jump), decodes async, loads the first cards eagerly and far ones lazily", () => {
    const first = renderToStaticMarkup(<FeedCard {...props({ index: 0, item: item({ media: [photo(1)] }) })} />);
    expect(first).toContain('width="1080"'); expect(first).toContain('height="1350"'); expect(first).toContain('loading="eager"'); expect(first).toContain('decoding="async"');
    const far = renderToStaticMarkup(<FeedCard {...props({ index: 9, near: false, item: item({ media: [photo(1)] }) })} />);
    expect(far).toContain('loading="lazy"');
  });
  it("multiple photos become a swipeable set with a position indicator", () => {
    const html = renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1), photo(2), photo(3)] }) })} />);
    expect(html).toContain("photo 2 of 3");
    expect(html).toContain("snap-x");
  });
});

describe("FeedCard: video never costs data it does not need", () => {
  const withVideo = (o: Partial<CardProps>) => renderToStaticMarkup(<FeedCard {...props({ item: item({ kind: "video", media: [video] }), ...o })} />);
  it("a video far from the screen has no source at all and preloads nothing", () => {
    const html = withVideo({ active: false, near: false });
    expect(html).not.toContain("https://signed.example/v.mp4");
    expect(html).toContain('preload="none"');
    expect(html).toContain("https://signed.example/p.jpg");                // but the poster shows instantly
  });
  it("a neighbour fetches only metadata; the active one loads and loops silently", () => {
    const near = withVideo({ active: false, near: true });
    expect(near).toContain('preload="metadata"'); expect(near).toContain("https://signed.example/v.mp4");
    const active = withVideo({ active: true, near: true });
    expect(active).toContain('preload="auto"'); expect(active).toContain("loop"); expect(active).toContain("playsInline");
    expect(active).toContain('aria-label="Turn sound on"');               // starts muted: browsers block, and people dislike, surprise sound
  });
  it("on a slow connection or Data Saver it waits for a tap instead of autoplaying", () => {
    const html = withVideo({ active: true, near: true, frugal: true });
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('aria-label="Play video"');
  });
  it("neighbours do not preload on a slow connection", () => {
    expect(withVideo({ active: false, near: true, frugal: true })).toContain('preload="none"');
  });
});

describe("FeedView & sheets", () => {
  it("opens on a loading state with a status for screen readers, not a blank page", () => {
    const html = renderToStaticMarkup(<FeedView tripId={null} trips={[]} hasProfile />);
    expect(html).toContain('role="feed"');
    expect(html).toContain("Loading");
    expect(html).toContain("Share a destination");
  });
  it("Add to trip: with no trips it points to creating one; with trips it lists them and explains approximate pins", () => {
    const none = renderToStaticMarkup(<AddToTripSheet item={item()} trips={[]} onClose={noop} onAdded={noop} />);
    expect(none).toContain("Create a trip");
    const some = renderToStaticMarkup(<AddToTripSheet item={item()} trips={[{ id: "t1", name: "Monsoon weekend" }]} onClose={noop} onAdded={noop} />);
    expect(some).toContain("Monsoon weekend");
    expect(some).toContain("approximate");
  });
});

import { Composer } from "@/components/feed/composer/Composer";
import { PostPreview } from "@/components/feed/composer/PostPreview";
import { MediaStep } from "@/components/feed/composer/MediaStep";
import { PlaceStep } from "@/components/feed/composer/PlaceStep";
import { DetailsStep } from "@/components/feed/composer/DetailsStep";

describe("Share flow", () => {
  it("opens on step 1 as a proper dialog: clear title, drop zone, privacy promise, a disabled Continue that says why", () => {
    const html = renderToStaticMarkup(<Composer hasProfile onClose={noop} onPosted={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Add photos or a video");
    expect(html).toContain("Show what it looks like");
    expect(html).toContain("Upload from device");
    expect(html).toContain("Your location stays private");
    expect(html).toContain("Live preview");
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
    expect(html).toContain("Add a photo or video");                          // the reason, in plain words
    expect(html).toContain("Share a written condition report instead");
  });
  it("without a profile it says so up front, but keeps the draft usable", () => {
    const html = renderToStaticMarkup(<Composer hasProfile={false} onClose={noop} onPosted={noop} />);
    expect(html).toContain("Pick a username before you share");
    expect(html).toContain("/profile");
  });
  it("the preview shows the destination, honest freshness and the approximate-area note as you choose them", () => {
    const html = renderToStaticMarkup(<PostPreview imageUrl="blob:x" destination="Matheran" spot="Echo Point" caption="Mist and a clear trail" capturedAt={null} precision="approx" isVideo={false} photoCount={1} />);
    expect(html).toContain("Matheran"); expect(html).toContain("Echo Point · approximate area"); expect(html).toContain("Just now"); expect(html).toContain("Mist and a clear trail");
    const old = renderToStaticMarkup(<PostPreview imageUrl={null} destination={null} spot="" caption="" capturedAt={new Date(Date.now() - 30 * 24 * 3_600_000).toISOString()} precision="exact" isVideo photoCount={0} />);
    expect(old).toContain("Choose a destination"); expect(old).not.toContain("Current ·"); expect(old).toContain("Video");
  });
  it("media step: previews, cover marker, remove buttons, add-more tile and per-file errors", () => {
    const ready = (n: number) => ({ id: `i${n}`, name: `p${n}.jpg`, status: "ready" as const, preview: `blob:${n}`, media: { type: "image" as const, blob: new Blob(), mime: "image/jpeg" as const, width: 1, height: 1, durationS: null, poster: null } });
    const html = renderToStaticMarkup(<MediaStep items={[ready(1), ready(2), { id: "e", name: "bad.heic", status: "error", error: "Couldn't read that photo." }]} dragging={false} busy={false} onFiles={noop} onRemove={noop} onMakeCover={noop} onWrittenOnly={noop} cameraSupport={{ photo: true, video: true }} onCamera={noop} />);
    expect(html).toContain("Cover"); expect(html).toContain('aria-label="Remove p1.jpg"'); expect(html).toContain('aria-label="Make p2.jpg the cover"');
    expect(html).toContain("Add more"); expect(html).toContain("Couldn&#x27;t read that photo.");
  });
  it("place step: a chosen destination shows as a confirmed card; precision options explain themselves; spots are one tap", () => {
    const html = renderToStaticMarkup(<PlaceStep place={{ name: "Matheran", address: "Raigad, Maharashtra", lat: 18.98, lng: 73.26, source: "map" }} spot="" precision="approx" onPlace={noop} onSpot={noop} onPrecision={noop} />);
    expect(html).toContain("Matheran"); expect(html).toContain("Change"); expect(html).toContain("Approximate area"); expect(html).toContain("Recommended"); expect(html).toContain("Viewpoint");
  });
  it("details step: quick condition chips, a character counter and an honest 'will show as' line", () => {
    const html = renderToStaticMarkup(<DetailsStep caption="Road is clear" when="older" hasMedia onCaption={noop} onWhen={noop} />);
    expect(html).toContain("13/500"); expect(html).toContain('aria-pressed="true"'); expect(html).toContain("Crowded");
    expect(html).toContain("4 weeks ago"); expect(html).toContain("nobody mistakes it for today");
  });
});

import { CameraCapture } from "@/components/feed/composer/CameraCapture";
describe("Camera", () => {
  const empty = (support: { photo: boolean; video: boolean }) => renderToStaticMarkup(<MediaStep items={[]} dragging={false} busy={false} onFiles={noop} onRemove={noop} onMakeCover={noop} onWrittenOnly={noop} cameraSupport={support} onCamera={noop} />);
  it("offers Take photo, Record video and Upload from device side by side when the browser has a camera", () => {
    const html = empty({ photo: true, video: true });
    expect(html).toContain("Take photo"); expect(html).toContain("Record video"); expect(html).toContain("Upload from device");
    expect(html).toContain("recorded or uploaded");
  });
  it("without camera support, upload is still there and there is no dead 'Record video' button", () => {
    const html = empty({ photo: false, video: false });
    expect(html).toContain("Upload from device"); expect(html).not.toContain("Record video");
  });
  it("a browser that can take photos but not record video says so by simply not offering recording", () => {
    const html = empty({ photo: true, video: false });
    expect(html).toContain("Take photo"); expect(html).not.toContain("Record video");
  });
  it("opens as a labelled full-screen dialog that tells you it is starting, with a close button", () => {
    const video = renderToStaticMarkup(<CameraCapture initialMode="video" onUse={noop} onClose={noop} onUpload={noop} />);
    expect(video).toContain('role="dialog"'); expect(video).toContain('aria-label="Record a video"'); expect(video).toContain("Starting camera"); expect(video).toContain('aria-label="Close camera"');
    expect(renderToStaticMarkup(<CameraCapture initialMode="photo" onUse={noop} onClose={noop} onUpload={noop} />)).toContain('aria-label="Take a photo"');
  });
});


import { PostMenu } from "@/components/feed/PostMenu";
import { LikersSheet } from "@/components/feed/LikersSheet";
import { NotificationsSheet } from "@/components/feed/NotificationsSheet";
import { SavedSheet } from "@/components/feed/SavedSheet";

describe("Own posts, notifications and saved", () => {
  it("every card shows exactly when it was posted, and marks your own", () => {
    const mine = renderToStaticMarkup(<FeedCard {...props({ item: item({ isMine: true, media: [photo(1)], createdAt: "2026-10-08T11:10:00Z" }) })} />);
    expect(mine).toContain("(you)"); expect(mine).toContain("Posted 8 Oct"); expect(mine).toContain('dateTime="2026-10-08T11:10:00Z"');
    expect(renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)] }) })} />)).not.toContain("(you)");
  });
  it("on your own post the menu offers Delete and 'who liked', and never Report or Block yourself", () => {
    const own = renderToStaticMarkup(<PostMenu item={item({ isMine: true, counts: { likes: 4, comments: 0, saves: 0, helpful: 0, tripAdds: 0 } })} onClose={noop} onDone={noop} onLikers={noop} />);
    expect(own).toContain("Delete post"); expect(own).toContain("See who liked this (4)");
    expect(own).not.toContain("Report"); expect(own).not.toContain("Block @"); expect(own).not.toContain("Not interested");
  });
  it("on someone else's post it offers Not interested, Report and Block, and no Delete", () => {
    const other = renderToStaticMarkup(<PostMenu item={item()} onClose={noop} onDone={noop} onLikers={noop} />);
    expect(other).toContain("Not interested in Matheran"); expect(other).toContain("Report"); expect(other).toContain("Block @ravi");
    expect(other).not.toContain("Delete post"); expect(other).not.toContain("who liked");
  });
  it("the three lists open with a loading state and a clear title", () => {
    expect(renderToStaticMarkup(<LikersSheet postId="p" count={7} onClose={noop} />)).toContain("Liked by 7");
    expect(renderToStaticMarkup(<NotificationsSheet onClose={noop} onUnread={noop} />)).toContain("Notifications");
    const saved = renderToStaticMarkup(<SavedSheet onClose={noop} onAddToTrip={noop} onUnsaved={noop} />);
    expect(saved).toContain("Saved"); expect(saved).toContain("animate-pulse");
  });
  it("the feed's corner has Share, Saved and a Notifications bell", () => {
    const html = renderToStaticMarkup(<FeedView tripId={null} trips={[]} hasProfile />);
    expect(html).toContain('aria-label="Share a destination"'); expect(html).toContain('aria-label="Saved posts"'); expect(html).toContain('aria-label="Notifications"');
  });
});

import { ContributionCard } from "@/components/ContributionCard";
import { DestinationSheet } from "@/components/feed/DestinationSheet";
import { ExperiencePicker } from "@/components/feed/composer/ExperiencePicker";

describe("Travel intelligence screens", () => {
  const exp = { crowd: "quiet" as const, conditions: ["foggy", "closed"], vibes: ["best_view", "sunrise", "food"], tip: "Go before 9 AM — parking fills up", fromArea: true };
  it("a post shows what the traveler reported: crowd, conditions, what was special, a tip, and 'posted from the area' as a hint", () => {
    const html = renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)], experience: exp }) })} />);
    expect(html).toContain("Quiet"); expect(html).toContain("Foggy"); expect(html).toContain("Closed"); expect(html).toContain("Best view");
    expect(html).toContain("Go before 9 AM"); expect(html).toContain("Posted from the area"); expect(html).toContain("can&#x27;t be proven");
    expect(html).not.toContain("At the time:");
  });
  it("an OLD post's conditions are labelled 'At the time', so they cannot be mistaken for today", () => {
    const old = item({ media: [photo(1)], experience: exp, freshness: { label: "4 weeks ago", state: "older", dot: "grey", usableAsCurrent: false } });
    const html = renderToStaticMarkup(<FeedCard {...props({ item: old })} />);
    expect(html).toContain("At the time:"); expect(html).not.toContain("bg-emerald-500/85");
  });
  it("Helpful sits beside Like for other people's posts, with its count, and is absent on your own", () => {
    const other = renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)], counts: { likes: 3, comments: 0, saves: 0, helpful: 17, tripAdds: 2 } }) })} />);
    expect(other).toContain('aria-label="This helped me decide"'); expect(other).toContain(">17<");
    expect(renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)], me: { liked: false, saved: false, helped: true } }) })} />)).toContain('aria-label="Remove helpful mark"');
    expect(renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)], isMine: true }) })} />)).not.toContain("This helped me decide");
  });
  it("the destination name opens 'what is it like right now'", () => {
    expect(renderToStaticMarkup(<FeedCard {...props({ item: item({ media: [photo(1)] }) })} />)).toContain('aria-label="What is it like at Matheran right now?"');
  });
  it("the feed offers modes; 'My trip' appears only when there is a trip", () => {
    const without = renderToStaticMarkup(<FeedView tripId={null} trips={[]} hasProfile />);
    for (const m of ["For you", "Right now", "Planning", "Hidden gems"]) expect(without).toContain(m);
    expect(without).not.toContain("My trip");
    expect(renderToStaticMarkup(<FeedView tripId="t1" trips={[{ id: "t1", name: "x" }]} hasProfile />)).toContain("My trip");
  });
  it("the destination view opens in a loading state with the destination as its title", () => {
    const html = renderToStaticMarkup(<DestinationSheet destinationId="d" name="Matheran" onClose={noop} onAddToTrip={noop} onShare={noop} />);
    expect(html).toContain("Matheran"); expect(html).toContain("animate-pulse");
  });
  it("the share flow's optional section is collapsed by default and says what it is for", () => {
    const html = renderToStaticMarkup(<ExperiencePicker crowd="crowded" conditions={["rainy"]} vibes={[]} tip="" wantsArea={false} onCrowd={noop} onConditions={noop} onVibes={noop} onTip={noop} onWantsArea={noop} />);
    expect(html).toContain("<details"); expect(html).not.toContain("<details open"); expect(html).toContain("Make it more useful"); expect(html).toContain("optional"); expect(html).toContain("2 added");
    expect(html).toContain("Crowded"); expect(html).toContain("Muddy / slippery"); expect(html).toContain("Hidden gem"); expect(html).toContain("Show that I posted from the area"); expect(html).toContain("not saved");
  });
  it("the profile shows impact from OTHER travelers, and invites a first post when there is none", () => {
    const some = renderToStaticMarkup(<ContributionCard posts={4} destinations={3} travelersHelped={27} saves={20} helpful={11} tripAdds={6} />);
    expect(some).toContain("27"); expect(some).toContain("traveler"); expect(some).toContain("Found helpful"); expect(some).toContain("Your own don");
    const none = renderToStaticMarkup(<ContributionCard posts={0} destinations={0} travelersHelped={0} saves={0} helpful={0} tripAdds={0} />);
    expect(none).toContain("Share one place"); expect(none).not.toContain("Found helpful");
    expect(renderToStaticMarkup(<ContributionCard posts={1} destinations={1} travelersHelped={1} saves={0} helpful={0} tripAdds={0} />)).toContain("traveler helped");
  });
});

