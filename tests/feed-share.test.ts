import { describe, expect, it, vi } from "vitest";
import { postPath, postUrl, shareContent, sharePost } from "@/lib/feed/share";

const item = (o: object = {}) => ({ id: "22222222-2222-4222-8222-222222222222", destination: { id: "d", name: "Matheran", slug: "matheran" }, placeName: "Echo Point", freshness: { label: "2 hours ago", state: "today", dot: "green", usableAsCurrent: true }, experience: { crowd: null, conditions: [], vibes: [], tip: null, fromArea: false }, ...o }) as never;

describe("a post has one address", () => {
  it("builds it from the id, with no double slashes", () => {
    expect(postPath("abc")).toBe("/discover/abc");
    expect(postUrl("https://trailmate.app/", "abc")).toBe("https://trailmate.app/discover/abc");
    expect(postUrl("https://trailmate.app", "abc")).toBe("https://trailmate.app/discover/abc");
  });
  it("the message is honest about how old the post is", () => {
    expect(shareContent(item(), "https://t.app").text).toContain("now (2 hours ago)");
    const old = shareContent(item({ freshness: { label: "3 weeks ago", state: "older", dot: "grey", usableAsCurrent: false } }), "https://t.app");
    expect(old.text).not.toContain("now");
    expect(old.title).toBe("Matheran, Echo Point on Trailmate");
    expect(shareContent(item({ placeName: "matheran" }), "https://t.app").title).toBe("Matheran on Trailmate");
  });
});

describe("sharing", () => {
  const abort = () => new DOMException("closed", "AbortError");
  it("uses the phone's share sheet when there is one", async () => {
    const share = vi.fn<(d: { title: string; text: string; url: string }) => Promise<void>>(async () => undefined);
    expect(await sharePost(item(), { origin: "https://t.app", share })).toBe("shared");
    expect(share.mock.calls[0]?.[0]).toMatchObject({ url: "https://t.app/discover/22222222-2222-4222-8222-222222222222" });
  });
  it("closing the share sheet is not an error and copies nothing", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await sharePost(item(), { origin: "https://t.app", share: async () => { throw abort(); }, writeText })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("copies the link when there is no share sheet, or it breaks", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await sharePost(item(), { origin: "https://t.app", writeText })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://t.app/discover/22222222-2222-4222-8222-222222222222");
    expect(await sharePost(item(), { origin: "https://t.app", share: async () => { throw new Error("boom"); }, writeText })).toBe("copied");
  });
  it("says so plainly when nothing works", async () => {
    expect(await sharePost(item(), { origin: "https://t.app" })).toBe("failed");
    expect(await sharePost(item(), { origin: "https://t.app", writeText: async () => { throw new Error("denied"); } })).toBe("failed");
  });
});
