import { beforeEach, describe, expect, it, vi } from "vitest";

type Err = { code?: string; message?: string } | null;
const state = {
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  profile: { id: "x" } as unknown,
  quotaOk: true,
  destId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as string | null,
  destErr: null as Err,
  postErr: null as Err,
  mediaErr: null as Err,
  filesExist: true,
  files: new Map<string, Uint8Array>(),
  inserts: [] as { table: string; payload: Record<string, unknown> | Record<string, unknown>[] }[],
  selectedAfterInsert: false,
  deleted: [] as string[],
  removed: [] as string[][],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  areaOk: true,
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
vi.mock("@/lib/social/storage", () => ({
  supabaseMediaStorage: () => ({
    createUploadTarget: async () => null,
    signedUrls: async () => new Map(),
    allExist: async () => state.filesExist,
    remove: async (paths: string[]) => { state.removed.push(paths); },
    readBytes: async (path: string, o: { maxBytes: number; range?: [number, number] }) => {
      const f = state.files.get(path) ?? JPEG;
      const part = o.range ? f.slice(o.range[0], o.range[1] + 1) : f;
      return part.length > o.maxBytes ? null : part;
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      if (fn === "consume_quota") return { data: state.quotaOk, error: null };
      if (fn === "verify_post_area") return { data: state.areaOk, error: null };
      if (fn === "resolve_destination") return { data: state.destErr ? null : state.destId, error: state.destErr };
      return { data: null, error: null };
    },
    storage: { from: () => ({
      createSignedUrls: async (paths: string[]) => ({ data: state.filesExist ? paths.map((p) => ({ path: p, signedUrl: `https://s/${p}`, error: null })) : [], error: null }),
      remove: async (paths: string[]) => { state.removed.push(paths); return { data: null, error: null }; },
    }) },
    from: (table: string) => {
      let inserted = false;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => { if (inserted) state.selectedAfterInsert = true; return b; },
        eq: (_k: string, v: string) => { if (table === "posts") state.deleted.push(v); return b; },
        delete: () => b,
        maybeSingle: async () => ({ data: state.profile, error: null }),
        single: async () => ({ data: null, error: null }),
        insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
          inserted = true; state.inserts.push({ table, payload });
          return Object.assign(b, { then: (r: (v: unknown) => unknown) => r({ data: null, error: table === "posts" ? state.postErr : state.mediaErr }) });
        },
      });
      return b;
    },
  }),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POST } from "@/app/api/posts/route";
const fixture = (n: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", "video", n)));

const U = "11111111-1111-4111-8111-111111111111";
const body = (o: Record<string, unknown> = {}) => ({ kind: "report", caption: "weather is very great", place_name: "vijayawada", destination_name: "Vijayawada", lat: 16.51, lng: 80.61, location_precision: "approx", media: [], ...o });
const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  Object.assign(state, { user: { id: U }, profile: { id: "x" }, quotaOk: true, destId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", destErr: null, postErr: null, mediaErr: null, filesExist: true, inserts: [], selectedAfterInsert: false, deleted: [], removed: [], rpcs: [], files: new Map(), areaOk: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/posts", () => {
  it("publishes a written report: server picks the destination and the post id, and never asks the insert to hand the row back", async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.id).toMatch(uuid);
    const ins = state.inserts.find((i) => i.table === "posts")!.payload as Record<string, unknown>;
    expect(ins.id).toBe(j.id);                                   // the id the client is told about is the id that was saved
    expect(ins.author_id).toBe(U);                               // from the session
    expect(ins.destination_id).toBe(state.destId);               // from the server's own lookup
    expect(state.selectedAfterInsert).toBe(false);               // regression: "insert … returning" is refused by the read policy
    expect(state.rpcs.find((r) => r.fn === "resolve_destination")!.args).toMatchObject({ _name: "Vijayawada" });
  });

  it("ignores any author, destination or moderation fields a client tries to send", async () => {
    await post(body({ author_id: "attacker", destination_id: "evil", moderation: "approved", status: "visible", id: "chosen-by-client" }));
    const ins = state.inserts.find((i) => i.table === "posts")!.payload as Record<string, unknown>;
    expect(ins.author_id).toBe(U); expect(ins.destination_id).toBe(state.destId); expect(ins.id).not.toBe("chosen-by-client");
    expect(ins).not.toHaveProperty("moderation"); expect(ins).not.toHaveProperty("status");
  });

  it("uses the place name when no destination name is given", async () => {
    await post(body({ destination_name: undefined }));
    expect(state.rpcs.find((r) => r.fn === "resolve_destination")!.args._name).toBe("vijayawada");
  });

  it("requires sign-in, a traveler profile, valid input, and respects the daily limit", async () => {
    state.user = null; expect((await post(body())).status).toBe(401);
    state.user = { id: U }; state.profile = null; expect((await post(body())).status).toBe(409);
    state.profile = { id: "x" };
    expect((await post(body({ kind: "report", caption: null }))).status).toBe(400);      // a report must say something
    expect((await post(body({ lat: 999 }))).status).toBe(400);
    state.quotaOk = false; expect((await post(body())).status).toBe(429);
    expect(state.inserts).toHaveLength(0);
  });

  it("a permission error is described as a permission error, never as a trip problem, and leaks no database text", async () => {
    state.postErr = { code: "42501", message: 'new row violates row-level security policy for table "posts"' };
    const res = await post(body());
    expect(res.status).toBe(403);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/permission/i); expect(text).not.toMatch(/trip|row-level|posts/i);
  });

  it("a bad destination name is a clear 400, not a mystery", async () => {
    state.destErr = { code: "22023", message: "invalid destination name" };
    expect((await post(body({ destination_name: "x" }))).status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects files that are not in the person's own folder or never finished uploading", async () => {
    const m = (path: string) => ({ storage_path: path, media_type: "image", mime: "image/jpeg", bytes: 1000, width: 10, height: 10 });
    expect((await post(body({ kind: "photo", media: [m("someone-else/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg")] }))).status).toBe(400);
    state.filesExist = false;
    expect((await post(body({ kind: "photo", media: [m(`${U}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`)] }))).status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it("if attaching media fails, the half-made post is removed and the uploads are cleaned up", async () => {
    state.mediaErr = { code: "XX", message: "boom" };
    const file = `${U}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    const res = await post(body({ kind: "photo", media: [{ storage_path: file, media_type: "image", mime: "image/jpeg", bytes: 1000, width: 10, height: 10 }] }));
    expect(res.status).toBe(500);
    expect(state.deleted.length).toBe(1);
    expect(state.removed[0]).toContain(file);
  });

  describe("the server checks the real files before anything is published", () => {
    const vid = (name: string, mime = "video/mp4") => ({ storage_path: `${U}/${name}.${mime === "video/mp4" ? "mp4" : "webm"}`, media_type: "video", mime, bytes: 100_000, width: 160, height: 120, duration_s: 10 });
    const withVideo = (name: string, file: string, mime = "video/mp4") => { const m = vid(name, mime); state.files.set(m.storage_path, fixture(file)); return body({ kind: "video", caption: null, media: [m] }); };
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    it("accepts real videos of every kind a phone or browser makes", async () => {
      expect((await post(withVideo(A, "classic-faststart-7s.mp4"))).status).toBe(201);
      expect((await post(withVideo("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "fragmented-17s.mp4"))).status).toBe(201);
      expect((await post(withVideo("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "webm-live-no-duration-23s.webm", "video/webm"))).status).toBe(201);
      expect((await post(withVideo("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "exactly-30s-fragmented.mp4"))).status).toBe(201);     // a clip stopped at the 30 s limit
    });

    it("refuses a 45-second video even though the request says it is 10 seconds, deletes the files, and creates nothing", async () => {
      const res = await post(withVideo(A, "too-long-45s.mp4"));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/30 seconds/);
      expect(state.inserts).toHaveLength(0);
      expect(state.removed.flat().some((p) => p.includes(A))).toBe(true);
      expect((await post(withVideo("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "too-long-fragmented-45s.mp4"))).status).toBe(422);
    });

    it("refuses a file that is not a video, one mislabelled as another format, and one it cannot measure", async () => {
      const m = vid(A); state.files.set(m.storage_path, new TextEncoder().encode("<html>hello</html>"));
      expect((await post(body({ kind: "video", caption: null, media: [m] }))).status).toBe(422);
      const mismatch = await post(withVideo("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "classic-faststart-7s.mp4", "video/webm"));
      expect(mismatch.status).toBe(422); expect((await mismatch.json()).error).toMatch(/kind of video/);
      expect(state.inserts).toHaveLength(0);
    });

    it("refuses a script or a renamed file posing as a photo", async () => {
      const path = `${U}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg`;
      state.files.set(path, new TextEncoder().encode("<svg onload=alert(1)></svg>"));
      const res = await post(body({ kind: "photo", media: [{ storage_path: path, media_type: "image", mime: "image/jpeg", bytes: 1000, width: 10, height: 10 }] }));
      expect(res.status).toBe(400);
      expect(state.inserts).toHaveLength(0);
    });
  });

  describe("what the traveler says about the place", () => {
    const fields = { crowd: "crowded", conditions: ["rainy", "muddy", "rainy"], vibes: ["best_view", "sunrise"], tip: "  Go before 9 AM  " };
    it("is saved exactly as given (tidied), and is all optional", async () => {
      expect((await post(body(fields))).status).toBe(201);
      const ins = state.inserts.find((i) => i.table === "posts")!.payload as Record<string, unknown>;
      expect(ins).toMatchObject({ crowd: "crowded", conditions: ["rainy", "muddy"], vibes: ["best_view", "sunrise"], tip: "Go before 9 AM" });   // duplicates dropped, spaces trimmed
      state.inserts.length = 0;
      expect((await post(body())).status).toBe(201);
      expect(state.inserts.find((i) => i.table === "posts")!.payload).toMatchObject({ crowd: null, conditions: [], vibes: [], tip: null });
    });
    it("refuses anything outside the shared vocabulary, too many tags, and a tip that is too short or too long", async () => {
      for (const bad of [{ crowd: "packed" }, { conditions: ["volcano"] }, { vibes: ["a", "b"] }, { conditions: ["rainy", "sunny", "foggy", "muddy", "road_good", "road_bad", "closed"] }, { tip: "ok" }, { tip: "x".repeat(161) }])
        expect((await post(body(bad))).status).toBe(400);
      expect(state.inserts).toHaveLength(0);
    });
    it("a client cannot award itself 'posted from the area': the claim is sent for checking, never stored from the request", async () => {
      const res = await post(body({ verified_area: true, device_lat: 16.51, device_lng: 80.61 }));
      const ins = state.inserts.find((i) => i.table === "posts")!.payload as Record<string, unknown>;
      expect(ins).not.toHaveProperty("verified_area"); expect(ins).not.toHaveProperty("device_lat");
      expect(state.rpcs.find((r) => r.fn === "verify_post_area")!.args).toMatchObject({ _lat: 16.51, _lng: 80.61 });
      expect((await res.json()).fromArea).toBe(true);
    });
    it("no location, or one the database does not accept, means no badge — and the post still publishes", async () => {
      expect((await (await post(body())).json()).fromArea).toBe(false);
      expect(state.rpcs.some((r) => r.fn === "verify_post_area")).toBe(false);
      state.areaOk = false;
      const res = await post(body({ device_lat: 28.6, device_lng: 77.2 }));
      expect(res.status).toBe(201); expect((await res.json()).fromArea).toBe(false);
    });
  });
});

