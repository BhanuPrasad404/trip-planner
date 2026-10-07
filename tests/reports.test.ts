import { describe, expect, it } from "vitest";
import { assignReports, isOwnPhotoPath, summarizeReports, timeAgo, type PlaceReportRow } from "@/lib/reports";

const NOW = new Date("2026-10-10T12:00:00Z");
const row = (id: string, lat: number, lng: number, daysAgo: number, extra: Partial<PlaceReportRow> = {}): PlaceReportRow => ({
  id, user_id: "u2", place_name: "x", lat, lng, tags: ["water_flowing"], note: null, photo_path: null,
  created_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), ...extra,
});
const places = [{ id: "A", lat: 17.0, lng: 80.0 }, { id: "B", lat: 17.0, lng: 80.2 }];
const url = (p: string) => `https://cdn/${p}`;

describe("assignReports", () => {
  it("gives each report to the nearest stop within 1.5 km and ignores far ones", () => {
    const out = assignReports(places, [row("r1", 17.001, 80.001, 1), row("r2", 17.0, 80.199, 2), row("far", 17.5, 80.5, 1)], "me", url);
    expect(out.A.map((r) => r.id)).toEqual(["r1"]);
    expect(out.B.map((r) => r.id)).toEqual(["r2"]);
    expect(Object.values(out).flat().some((r) => r.id === "far")).toBe(false);
  });

  it("sorts newest first, caps per stop, marks mine, builds photo urls and drops unknown tags", () => {
    const rows = [
      row("old", 17, 80, 10),
      row("new", 17, 80, 1, { user_id: "me", photo_path: "me/a.jpg", tags: ["dry", "weird" as never] }),
      ...Array.from({ length: 8 }, (_, i) => row(`m${i}`, 17, 80, 20 + i)),
    ];
    const out = assignReports(places, rows, "me", url, 5);
    expect(out.A).toHaveLength(5);
    expect(out.A[0]).toMatchObject({ id: "new", mine: true, photoUrl: "https://cdn/me/a.jpg", tags: ["dry"] });
    expect(out.A[1].id).toBe("old");
  });
});

describe("summarizeReports", () => {
  it("counts tags over the window, most reported first, ignoring old reports", () => {
    const views = assignReports(places, [
      row("1", 17, 80, 1), row("2", 17, 80, 3, { tags: ["water_flowing", "crowded"] }), row("3", 17, 80, 50),
    ], "me", url).A;
    const s = summarizeReports(views, NOW, 30);
    expect(s.count).toBe(2);
    expect(s.top[0]).toEqual({ tag: "water_flowing", count: 2 });
    expect(s.top[1]).toEqual({ tag: "crowded", count: 1 });
  });
  it("is empty with no recent reports", () => {
    expect(summarizeReports([], NOW)).toEqual({ count: 0, top: [], latest: null });
  });
});

describe("timeAgo", () => {
  it("speaks in human units", () => {
    const ago = (ms: number) => timeAgo(new Date(NOW.getTime() - ms).toISOString(), NOW);
    expect(ago(5 * 60_000)).toBe("just now");
    expect(ago(3 * 3_600_000)).toBe("3 h ago");
    expect(ago(30 * 3_600_000)).toBe("yesterday");
    expect(ago(5 * 86_400_000)).toBe("5 days ago");
    expect(ago(90 * 86_400_000)).toBe("3 months ago");
  });
});

describe("isOwnPhotoPath", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  it("accepts only <my id>/<safe file>", () => {
    expect(isOwnPhotoPath(`${me}/abc.jpg`, me)).toBe(true);
    expect(isOwnPhotoPath(`22222222-2222-2222-2222-222222222222/abc.jpg`, me)).toBe(false);
    expect(isOwnPhotoPath(`${me}/../x.jpg`, me)).toBe(false);
    expect(isOwnPhotoPath(`${me}/a/b.jpg`, me)).toBe(false);
  });
});
