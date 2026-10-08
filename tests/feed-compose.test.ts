import { describe, expect, it } from "vitest";
import { appendChip, blocker, canAddMore, capturedAtFor, likeEscape, mergePlaces, postKindFor, WHEN_OPTIONS, type ComposeState, type PlaceChoice } from "@/lib/feed/compose";
import { freshnessOf } from "@/lib/social/freshness";

const place = (name: string, lat = 18.98, lng = 73.26, source: PlaceChoice["source"] = "map"): PlaceChoice => ({ name, address: "", lat, lng, source });
const base: ComposeState = { items: [], writtenOnly: false, place: null, caption: "" };

describe("what a post needs before each step", () => {
  it("media: needs a file, or an explicit choice to share a written report; waits for files and refuses broken ones", () => {
    expect(blocker("media", base)).toMatch(/Add a photo or video/);
    expect(blocker("media", { ...base, writtenOnly: true })).toBeNull();
    expect(blocker("media", { ...base, items: [{ status: "ready", type: "image" }] })).toBeNull();
    expect(blocker("media", { ...base, items: [{ status: "preparing" }] })).toMatch(/ready/);
    expect(blocker("media", { ...base, items: [{ status: "ready", type: "image" }, { status: "error" }] })).toMatch(/Remove/);
  });
  it("place: a destination is required", () => {
    expect(blocker("place", base)).toMatch(/Choose the destination/);
    expect(blocker("place", { ...base, place: place("Matheran") })).toBeNull();
  });
  it("details: media posts may go without words; a written report must say something", () => {
    expect(blocker("details", { ...base, items: [{ status: "ready", type: "image" }] })).toBeNull();
    expect(blocker("details", { ...base, writtenOnly: true, caption: "   " })).toMatch(/Write what/);
    expect(blocker("details", { ...base, writtenOnly: true, caption: "Road clear" })).toBeNull();
  });
  it("kind follows the media: a video wins, photos next, nothing means a report", () => {
    expect(postKindFor([])).toBe("report");
    expect(postKindFor([{ status: "ready", type: "image" }])).toBe("photo");
    expect(postKindFor([{ status: "ready", type: "video" }])).toBe("video");
  });
  it("up to 4 photos, or one video on its own", () => {
    expect(canAddMore([])).toBe(true);
    expect(canAddMore(Array.from({ length: 3 }, () => ({ status: "ready" as const, type: "image" as const })))).toBe(true);
    expect(canAddMore(Array.from({ length: 4 }, () => ({ status: "ready" as const, type: "image" as const })))).toBe(false);
    expect(canAddMore([{ status: "ready", type: "video" }])).toBe(false);
  });
});

describe("when was this?", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("'just now' sends no time (the server uses upload time); others are in the past", () => {
    expect(capturedAtFor("now", now)).toBeNull();
    expect(Date.parse(capturedAtFor("today", now)!)).toBe(now.getTime() - 6 * 3_600_000);
  });
  it("what the person is promised matches what the feed will actually show", () => {
    for (const w of WHEN_OPTIONS) {
      const iso = capturedAtFor(w.id, now);
      const label = freshnessOf(iso ?? now, iso, now).label;
      expect(label).toBe(w.appearsAs);
    }
  });
  it("'Older' is never shown as current", () => {
    const iso = capturedAtFor("older", now)!;
    expect(freshnessOf(iso, iso, now).usableAsCurrent).toBe(false);
  });
});

describe("quick condition chips", () => {
  it("add to the caption once, with sensible punctuation, never past the limit", () => {
    expect(appendChip("", "Road is clear")).toBe("Road is clear");
    expect(appendChip("Lovely morning.", "Crowded")).toBe("Lovely morning.. Crowded".replace("..", "."));
    expect(appendChip("Road is clear", "road is clear")).toBe("Road is clear");
    const full = "x".repeat(495);
    expect(appendChip(full, "Crowded")).toBe(full);
  });
});

describe("destination search results", () => {
  it("lists Trailmate's own destinations first and never the same place twice", () => {
    const local = [place("Matheran", 18.98, 73.26, "trailmate")];
    const map = [place("Matheran", 18.9867, 73.2672), place("Matheran Hill Station", 18.99, 73.27), place("Matheran", 12.97, 77.59)];
    const out = mergePlaces(local, map);
    expect(out[0].source).toBe("trailmate");
    expect(out.filter((p) => p.name === "Matheran" && p.lat > 18)).toHaveLength(1);
    expect(out.some((p) => p.name === "Matheran Hill Station")).toBe(true);
    expect(out.some((p) => p.name === "Matheran" && p.lat === 12.97)).toBe(true);   // same name far away is a different place
  });
  it("escapes wildcard characters so '%' searches for a percent sign, not everything", () => {
    expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});
