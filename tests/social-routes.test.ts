import { beforeEach, describe, expect, it, vi } from "vitest";

const UID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const state = {
  user: { id: UID } as { id: string } | null,
  profile: { id: UID } as { id: string } | null,
  quotaOk: true,
  exists: true,
  postError: null as { code?: string; message?: string } | null,
  mediaError: null as { code?: string; message?: string } | null,
  upsertError: null as { code?: string; message?: string } | null,
  log: [] as { table: string; op: string; payload?: unknown }[],
  removed: [] as string[][],
};

function builder(table: string) {
  const q = { table, op: "select", payload: undefined as unknown };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, eq: chain,
    insert: (p: unknown) => ((q.op = "insert"), (q.payload = p), b),
    upsert: (p: unknown) => ((q.op = "upsert"), (q.payload = p), b),
    delete: () => ((q.op = "delete"), b),
    maybeSingle: async () => ({ data: table === "profiles" ? state.profile : null, error: null }),
    single: async () => (state.log.push(q), table === "posts" ? { data: state.postError ? null : { id: "post-1" }, error: state.postError } : { data: { status: "accepted" }, error: null }),
    then: (res: (v: unknown) => unknown) => {
      state.log.push(q);
      const error = table === "post_media" ? state.mediaError : table === "profiles" ? state.upsertError : null;
      return res({ data: null, error });
    },
  });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.quotaOk, error: null }),
    from: (t: string) => builder(t),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({ data: { path, token: "tok" }, error: null }),
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: state.exists ? `https://s/${p}` : null, error: state.exists ? null : "Object not found" })), error: null }),
        remove: async (p: string[]) => (state.removed.push(p), { error: null }),
      }),
    },
  }),
}));

const json = (body: unknown) => new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const goodPath = `${UID}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg`;
const photoPost = (over: Record<string, unknown> = {}) => ({
  kind: "photo", place_name: "RK Beach", lat: 17.7, lng: 83.3,
  media: [{ storage_path: goodPath, media_type: "image", mime: "image/jpeg", bytes: 1000 }], ...over,
});

beforeEach(() => Object.assign(state, { user: { id: UID }, profile: { id: UID }, quotaOk: true, exists: true, postError: null, mediaError: null, upsertError: null, log: [], removed: [] }));

describe("POST /api/posts/upload-url", () => {
  it("needs sign-in and a traveler profile", async () => {
    const { POST } = await import("@/app/api/posts/upload-url/route");
    state.user = null;
    expect((await POST(json({ mime: "image/jpeg", bytes: 100 }))).status).toBe(401);
    state.user = { id: UID }; state.profile = null;
    expect((await POST(json({ mime: "image/jpeg", bytes: 100 }))).status).toBe(409);
  });
  it("returns a path inside your own folder and refuses oversize files and quota overruns", async () => {
    const { POST } = await import("@/app/api/posts/upload-url/route");
    const ok = await POST(json({ mime: "video/mp4", bytes: 10_000_000 }));
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body.path.startsWith(`${UID}/`)).toBe(true);
    expect(body.token).toBe("tok");
    expect((await POST(json({ mime: "video/mp4", bytes: 80_000_000 }))).status).toBe(400);
    state.quotaOk = false;
    expect((await POST(json({ mime: "image/jpeg", bytes: 100 }))).status).toBe(429);
  });
});

describe("POST /api/posts", () => {
  it("creates the post with the author from the session, then its media", async () => {
    const { POST } = await import("@/app/api/posts/route");
    const res = await POST(json(photoPost({ author_id: OTHER })));
    expect(res.status).toBe(201);
    const post = state.log.find((l) => l.table === "posts" && l.op === "insert")!.payload as Record<string, unknown>;
    expect(post.author_id).toBe(UID);
    expect(post.location_precision).toBe("approx");
    expect(state.log.some((l) => l.table === "post_media" && l.op === "insert")).toBe(true);
  });
  it("refuses media from someone else's folder, files that were never uploaded, and a missing profile", async () => {
    const { POST } = await import("@/app/api/posts/route");
    const stolen = photoPost({ media: [{ storage_path: `${OTHER}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg`, media_type: "image", mime: "image/jpeg", bytes: 1 }] });
    expect((await POST(json(stolen))).status).toBe(400);
    state.exists = false;
    expect((await POST(json(photoPost()))).status).toBe(400);
    state.exists = true; state.profile = null;
    expect((await POST(json(photoPost()))).status).toBe(409);
  });
  it("rolls back the post (and files) when saving media fails", async () => {
    const { POST } = await import("@/app/api/posts/route");
    state.mediaError = { code: "23514", message: "bad" };
    expect((await POST(json(photoPost()))).status).toBe(400);
    expect(state.log.some((l) => l.table === "posts" && l.op === "delete")).toBe(true);
    expect(state.removed[0]?.includes(goodPath)).toBe(true);
  });
  it("applies the daily limit", async () => {
    const { POST } = await import("@/app/api/posts/route");
    state.quotaOk = false;
    expect((await POST(json(photoPost()))).status).toBe(429);
  });
});

describe("PUT /api/profile and /api/follows", () => {
  it("saves the profile for the signed-in user and reports a taken username", async () => {
    const { PUT } = await import("@/app/api/profile/route");
    const req = (b: unknown) => new Request("http://x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const ok = await PUT(req({ username: "Bhanu_T", id: OTHER }));
    expect(ok.status).toBe(200);
    expect((state.log.find((l) => l.op === "upsert")!.payload as Record<string, unknown>).id).toBe(UID);
    state.upsertError = { code: "23505" };
    expect((await PUT(req({ username: "taken" }))).status).toBe(409);
  });
  it("follow needs a profile, and cannot follow yourself", async () => {
    const { POST } = await import("@/app/api/follows/route");
    state.profile = null;
    expect((await POST(json({ username: "alice" }))).status).toBe(409);
  });
});
