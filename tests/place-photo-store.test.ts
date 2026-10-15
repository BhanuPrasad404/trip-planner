import { describe, expect, it, vi } from "vitest";
import { MemoryPhotoStore, RESOLVER_VERSION, SupabasePhotoStore, photoKey, validateStoredPhoto, type StoreEntry } from "@/lib/place-photos/store";
import type { PlacePhoto } from "@/lib/place-photos/types";

const photo = (o: Partial<PlacePhoto> = {}): PlacePhoto => ({
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fort.jpg/330px-Fort.jpg", srcSet: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fort.jpg/120px-Fort.jpg 120w",
  width: 500, height: 333, title: "Fort", pageUrl: "https://en.wikipedia.org/wiki/Fort", source: "wikipedia", creditUrl: "https://commons.wikimedia.org/wiki/File:Fort.jpg",
  author: "Jane", licence: "CC BY-SA 4.0", licenceUrl: null, ...o,
});
const entry = (key: string, found = true): StoreEntry => ({ key, name: "Fort", lat: 17, lng: 78, ttlMs: 1000, value: found ? { status: "found", photo: photo() } : { status: "none", reason: "no_page" } });

describe("RESOLVER_VERSION", () => {
  it("was bumped when the matching rules changed, so answers cached by the earlier rules are ignored", () => expect(RESOLVER_VERSION).toBeGreaterThanOrEqual(4));
});

describe("photoKey: the same place however it was typed", () => {
  it("ignores case, accents, brackets, punctuation and spacing; keeps different places apart", () => {
    expect(photoKey("Charminar", 17.3616, 78.4747)).toBe(photoKey("  CHARMINAR  (Hyderabad) ", 17.3619, 78.4741));
    expect(photoKey("Hotel Évora", 15.5, 73.8)).toBe(photoKey("hotel evora", 15.501, 73.804));
    expect(photoKey("Charminar", 17.36, 78.47)).not.toBe(photoKey("Charminar", 18.36, 78.47));
    expect(photoKey("Golconda Fort", 17.38, 78.40)).not.toBe(photoKey("Charminar", 17.38, 78.40));
  });
  it("stays within the database's key limit even for absurd names", () => expect(photoKey("x".repeat(500), 1, 1).length).toBeLessThanOrEqual(140));
});

describe("validateStoredPhoto: the database is not trusted", () => {
  it("accepts a photo that still passes every gate", () => expect(validateStoredPhoto(photo())?.licence).toBe("CC BY-SA 4.0"));
  it.each([
    ["a non-Commons image address", { url: "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Fort.jpg/330px-Fort.jpg" }],
    ["a foreign host", { url: "https://evil.example/x.jpg" }],
    ["a non-free licence", { licence: "CC BY-NC 4.0" }],
    ["a missing licence", { licence: "" }],
    ["a page link to another site", { pageUrl: "https://evil.example/wiki/Fort" }],
    ["a javascript credit link", { creditUrl: "javascript:alert(1)" }],
    ["a credit link that is not Commons", { creditUrl: "https://evil.example/File:Fort.jpg" }],
    ["a srcset with a foreign address", { srcSet: "https://evil.example/a.jpg 120w" }],
    ["an unknown extra field", { onload: "alert(1)" }],
  ])("rejects %s", (_n, o) => expect(validateStoredPhoto({ ...photo(), ...o })).toBeNull());
  it("accepts a Commons-sourced photo only with a Commons page link, and a Wikipedia one only with a Wikipedia link", () => {
    const c = photo({ source: "commons", via: "commons", pageUrl: "https://commons.wikimedia.org/wiki/File:Fort.jpg" });
    expect(validateStoredPhoto(c)?.source).toBe("commons");
    expect(validateStoredPhoto({ ...c, pageUrl: "https://en.wikipedia.org/wiki/Fort" })).toBeNull();
    expect(validateStoredPhoto({ ...c, pageUrl: "https://evil.example/File:Fort.jpg" })).toBeNull();
    expect(validateStoredPhoto(photo({ pageUrl: "https://commons.wikimedia.org/wiki/File:Fort.jpg" }))).toBeNull();
    expect(validateStoredPhoto({ ...c, licence: "CC BY-NC 4.0" })).toBeNull();
  });
  it("rejects junk", () => { for (const j of [null, "x", 5, {}, []]) expect(validateStoredPhoto(j)).toBeNull(); });
});

describe("MemoryPhotoStore", () => {
  it("returns what was stored until it expires", async () => {
    let t = 0;
    const s = new MemoryPhotoStore(() => t);
    await s.putMany([entry("a")]);
    expect((await s.getMany(["a", "b"])).has("a")).toBe(true);
    expect((await s.getMany(["a", "b"])).has("b")).toBe(false);
    t = 1001;
    expect((await s.getMany(["a"])).size).toBe(0);
  });
  it("is bounded", async () => {
    const s = new MemoryPhotoStore(() => 0, 3);
    await s.putMany(["a", "b", "c", "d"].map((k) => entry(k)));
    expect((await s.getMany(["a", "b", "c", "d"])).size).toBe(3);
  });
});

// A tiny stand-in for the Supabase query builder: records the calls and answers with canned rows.
function fakeDb(rows: unknown[], error: { message: string } | null = null) {
  const calls: { op: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  const chain = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); return builder; };
  for (const op of ["select", "in", "eq", "gt"]) builder[op] = chain(op);
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error });
  const upserts: { rows: unknown[]; opts: unknown }[] = [];
  const db = { from: vi.fn(() => ({ ...builder, upsert: async (r: unknown[], opts: unknown) => { upserts.push({ rows: r, opts }); return { error }; } })) };
  return { db: db as never, calls, upserts };
}

describe("SupabasePhotoStore", () => {
  it("reads only current-version, unexpired rows by key, and re-validates what it gets back", async () => {
    const { db, calls } = fakeDb([
      { key: "good", status: "found", photo: photo(), reason: null },
      { key: "poisoned", status: "found", photo: photo({ licence: "CC BY-NC 4.0" }), reason: null },
      { key: "none", status: "none", photo: null, reason: "far" },
      { key: "oddreason", status: "none", photo: null, reason: "<script>" },
    ]);
    const got = await new SupabasePhotoStore(db, () => 0).getMany(["good", "poisoned", "none", "oddreason"]);
    expect(got.get("good")?.status).toBe("found");
    expect(got.has("poisoned")).toBe(false); // a tampered row never reaches the screen
    expect(got.get("none")).toEqual({ status: "none", reason: "far" });
    expect(got.get("oddreason")).toEqual({ status: "none", reason: "no_page" });
    expect(calls.find((c) => c.op === "eq")?.args).toEqual(["algo", RESOLVER_VERSION]); // old-algorithm answers are ignored
    expect(calls.some((c) => c.op === "gt" && c.args[0] === "expires_at")).toBe(true);
  });
  it("writes upserts keyed by 'key', carrying the algorithm version and an expiry", async () => {
    const { db, upserts } = fakeDb([]);
    await new SupabasePhotoStore(db, () => 1_000_000).putMany([entry("a"), entry("b", false)]);
    expect(upserts[0].opts).toEqual({ onConflict: "key" });
    const rows = upserts[0].rows as { key: string; status: string; photo: unknown; reason: unknown; algo: number; expires_at: string }[];
    expect(rows.map((r) => [r.key, r.status, r.photo !== null, r.reason])).toEqual([["a", "found", true, null], ["b", "none", false, "no_page"]]);
    expect(rows.every((r) => r.algo === RESOLVER_VERSION && new Date(r.expires_at).getTime() === 1_001_000)).toBe(true);
  });
  it("splits big writes into batches of 100", async () => {
    const { db, upserts } = fakeDb([]);
    await new SupabasePhotoStore(db).putMany(Array.from({ length: 250 }, (_, i) => entry(`k${i}`)));
    expect(upserts.map((u) => u.rows.length)).toEqual([100, 100, 50]);
  });
  it("with the table missing (migration not applied) it keeps working from memory and stops hammering the database", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, upserts } = fakeDb([], { message: 'relation "place_photo_cache" does not exist' });
    let t = 0;
    const s = new SupabasePhotoStore(db, () => t);
    await s.putMany([entry("a")]); // fails against the database…
    expect((await s.getMany(["a"])).get("a")?.status).toBe("found"); // …but is still remembered locally
    await s.putMany([entry("b")]);
    expect(upserts).toHaveLength(1); // the second write did not even try the database
    expect(err).toHaveBeenCalledTimes(1); // one log line, not one per request
    t = 6 * 60_000; // five minutes later it tries again
    await s.putMany([entry("c")]);
    expect(upserts.length).toBeGreaterThan(1);
    err.mockRestore();
  });
  it("never throws, even when the client itself blows up", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { from: () => { throw new Error("boom"); } } as never;
    const s = new SupabasePhotoStore(db);
    expect((await s.getMany(["a"])).size).toBe(0);
    await expect(s.putMany([entry("a")])).resolves.toBeUndefined();
    err.mockRestore();
  });
});
