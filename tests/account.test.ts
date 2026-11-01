import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
import { buildAccountExport, collectUploadPaths, deleteAccount, exportFileName, EXPORT_ROW_LIMIT } from "@/lib/server/account";
import { reportError } from "@/lib/monitoring";

const UID = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const user = { id: UID, email: "Ann@Example.com", created_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-10-10T00:00:00Z", user_metadata: { accepted_terms_version: "2026-10-12", accepted_terms_at: "2026-10-01T00:00:00Z" } } as unknown as User;

type Rows = Record<string, Record<string, unknown>[]>;
function fake(opts: { tables?: Rows; failTable?: string; missingTable?: string; files?: Record<string, string[]>; failRemove?: boolean; rpcError?: { code?: string; message: string } | null } = {}) {
  const calls: string[] = [];
  const removed: string[] = [];
  const tables = opts.tables ?? {};
  const files = opts.files ?? {};
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain, limit: chain,
      eq: (col: string, v: unknown) => { rows = rows.filter((r) => !(col in r) || r[col] === v); return q; }, // unknown (embedded) columns are not filtered
      in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => res(opts.missingTable === table ? { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } } : opts.failTable === table ? { data: null, error: { message: "denied" } } : { data: rows, error: null }),
    });
    return q;
  };
  const storage = { from: (bucket: string) => ({
    list: async (prefix: string, o: { limit: number; offset: number }) => ({ data: (files[bucket] ?? []).filter((p) => p.startsWith(`${prefix}/`)).map((p) => ({ name: p.slice(prefix.length + 1), id: "x" })).slice(o.offset, o.offset + o.limit), error: null }),
    remove: async (paths: string[]) => { calls.push("remove"); if (opts.failRemove) return { data: null, error: { message: "boom" } }; removed.push(...paths.map((p) => `${bucket}:${p}`)); return { data: [], error: null }; },
    createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })), error: null }),
  }) };
  const client = {
    from, storage,
    rpc: async (name: string) => { calls.push(`rpc:${name}`); return { data: null, error: opts.rpcError ?? null }; },
    auth: { signOut: async () => { calls.push("signOut"); return { error: null }; } },
  } as unknown as SupabaseClient;
  return { client, calls, removed };
}

describe("exportFileName", () => { it("is dated and has no spaces", () => { expect(exportFileName(new Date("2026-10-12T10:00:00Z"))).toBe("trailmate-my-data-2026-10-12.json"); }); });

describe("buildAccountExport", () => {
  const tables: Rows = {
    profiles: [{ id: UID, username: "ann" }],
    trips: [{ id: "t1", owner_id: UID, name: "Mine" }, { id: "t2", owner_id: OTHER, name: "Shared" }],
    trip_members: [{ trip_id: "t1", user_id: UID }, { trip_id: "t2", user_id: UID }],
    places: [{ id: "p1", trip_id: "t1" }, { id: "p2", trip_id: "t2" }, { id: "p3", trip_id: "other-trip" }],
    posts: [{ id: "post1", author_id: UID }],
    post_media: [{ post_id: "post1", storage_path: `${UID}/m1.jpg`, poster_path: `${UID}/m1p.jpg` }, { post_id: "post1", storage_path: `${OTHER}/stolen.jpg`, poster_path: null }],
    place_reports: [{ user_id: UID, photo_path: `${UID}/r1.jpg` }],
    feedback: [{ user_id: UID, message: "hi" }],
  };
  it("collects what the person owns and belongs to, labels their role, and explains itself", async () => {
    const { client } = fake({ tables });
    const out = await buildAccountExport(client, user, new Date("2026-10-12T00:00:00Z"));
    expect(out.account).toMatchObject({ id: UID, email: "Ann@Example.com", terms_version: "2026-10-12" });
    expect(out.readme).toMatch(/Links in 'files' stop working after one hour/);
    expect(out.sections.profile).toHaveLength(1);
    expect(out.sections.trips.map((t) => [t.id, t.my_role])).toEqual([["t1", "owner"], ["t2", "member"]]);
    expect(out.sections.trip_stops.map((p) => p.id).sort()).toEqual(["p1", "p2"]);        // stops of MY trips only
    expect(out.sections.feedback).toHaveLength(1);
    expect(out.warnings).toEqual([]);
  });
  it("includes the person's own journey history and the bookings they entered (and no one else's)", async () => {
    const t: Rows = { ...tables, trip_events: [{ user_id: UID, kind: "departed", occurred_at: "2026-11-02T16:30:00Z" }, { user_id: OTHER, kind: "arrived", occurred_at: "2026-11-02T17:00:00Z" }], trip_commitments: [{ created_by: UID, label: "Hotel" }, { created_by: OTHER, label: "Their hotel" }] };
    const out = await buildAccountExport(fake({ tables: t }).client, user);
    expect(out.sections.journey_events).toEqual([{ user_id: UID, kind: "departed", occurred_at: "2026-11-02T16:30:00Z" }]);
    expect(out.sections.bookings_i_entered).toEqual([{ created_by: UID, label: "Hotel" }]);
    expect(out.readme).toMatch(/journey history/);
  });
  it("where those tables don't exist yet the export says nothing about them: no section, no warning", async () => {
    const a = await buildAccountExport(fake({ tables, missingTable: "trip_events" }).client, user);
    const b = await buildAccountExport(fake({ tables, missingTable: "trip_commitments" }).client, user);
    for (const out of [a, b]) { expect(out.warnings).toEqual([]); expect(out.sections.journey_events).toBeUndefined(); expect(out.sections.bookings_i_entered).toBeUndefined(); }
  });
  it("a journey-history table that exists but cannot be read IS reported (only 'not there yet' is silent)", async () => {
    const out = await buildAccountExport(fake({ tables, failTable: "trip_events" }).client, user);
    expect(out.warnings.join()).toMatch(/journey_events: could not be read/);
  });
  it("includes temporary links only for files inside the person's own folder", async () => {
    const { client } = fake({ tables });
    const out = await buildAccountExport(client, user);
    const paths = out.files.map((f) => f.path).sort();
    expect(paths).toEqual([`${UID}/m1.jpg`, `${UID}/m1p.jpg`, `${UID}/r1.jpg`]);
    expect(paths.join()).not.toContain(OTHER);
    expect(out.files.every((f) => f.temporary_link?.startsWith("https://signed.example/"))).toBe(true);
  });
  it("one unreadable section becomes a warning; everything else is still delivered", async () => {
    const { client } = fake({ tables, failTable: "feedback" });
    const out = await buildAccountExport(client, user);
    expect(out.warnings.join()).toMatch(/feedback: could not be read/);
    expect(out.sections.trips).toHaveLength(2);
  });
  it("says so when a list was cut at the row limit", async () => {
    const many = Array.from({ length: EXPORT_ROW_LIMIT }, (_, i) => ({ user_id: UID, message: `m${i}` }));
    const out = await buildAccountExport(fake({ tables: { feedback: many } }).client, user);
    expect(out.warnings.join()).toMatch(/feedback: only the first 5000 rows/);
  });
  it("contains no other person's email or name (only their opaque ids where unavoidable)", async () => {
    const out = await buildAccountExport(fake({ tables: { ...tables, profiles: [{ id: UID, username: "ann" }, { id: OTHER, username: "ben", email: "ben@example.com" }] } }).client, user);
    expect(JSON.stringify(out)).not.toContain("ben@example.com");
  });
});

describe("collectUploadPaths", () => {
  it("gathers files rows point at and anything else in the person's own folder, never anyone else's", async () => {
    const { client } = fake({
      tables: { post_media: [{ storage_path: `${UID}/a.jpg`, poster_path: `${OTHER}/x.jpg` }], place_reports: [{ user_id: UID, photo_path: `${UID}/r.jpg` }], profiles: [{ id: UID, avatar_path: `${UID}/av.jpg` }] },
      files: { "post-media": [`${UID}/a.jpg`, `${UID}/orphan.mp4`, `${OTHER}/theirs.jpg`], "report-photos": [`${UID}/r.jpg`] },
    });
    const groups = await collectUploadPaths(client, UID);
    const post = groups.find((g) => g.bucket === "post-media")!.paths.sort();
    expect(post).toEqual([`${UID}/a.jpg`, `${UID}/av.jpg`, `${UID}/orphan.mp4`]);
    expect(groups.find((g) => g.bucket === "report-photos")!.paths).toEqual([`${UID}/r.jpg`]);
  });
});

describe("deleteAccount", () => {
  const good = { confirm: "ann@example.com", password: "pw" };
  beforeEach(() => vi.mocked(reportError).mockClear());

  it("a mistyped email stops everything before anything is touched", async () => {
    const f = fake(); const verify = vi.fn(async () => true);
    const r = await deleteAccount({ supabase: f.client, user, input: { confirm: "someone@else.com", password: "pw" }, verifyPassword: verify });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(verify).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  });
  it("a wrong password stops everything before anything is touched", async () => {
    const f = fake();
    const r = await deleteAccount({ supabase: f.client, user, input: good, verifyPassword: async () => false });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(f.calls).toEqual([]);
  });
  it("the email check ignores capital letters and spaces around it", async () => {
    const f = fake();
    expect((await deleteAccount({ supabase: f.client, user, input: { confirm: "  ANN@example.COM ", password: "pw" }, verifyPassword: async () => true })).ok).toBe(true);
  });
  it("success: files are removed BEFORE the database function runs, then the session ends", async () => {
    const f = fake({ files: { "post-media": [`${UID}/a.jpg`] } });
    const verify = vi.fn(async () => true);
    const r = await deleteAccount({ supabase: f.client, user, input: good, verifyPassword: verify });
    expect(r).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledWith("Ann@Example.com", "pw");
    expect(f.removed).toEqual([`post-media:${UID}/a.jpg`]);
    expect(f.calls).toEqual(["remove", "rpc:delete_my_account", "signOut"]);
  });
  it("if a file cannot be removed NOTHING is deleted, the person is told, and the problem is reported", async () => {
    const f = fake({ files: { "post-media": [`${UID}/a.jpg`] }, failRemove: true });
    const r = await deleteAccount({ supabase: f.client, user, input: good, verifyPassword: async () => true });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(f.calls).not.toContain("rpc:delete_my_account");
    expect(reportError).toHaveBeenCalled();
  });
  it("if the database function has not been installed yet it says so plainly (503)", async () => {
    const f = fake({ rpcError: { code: "PGRST202", message: "Could not find the function public.delete_my_account" } });
    const r = await deleteAccount({ supabase: f.client, user, input: good, verifyPassword: async () => true });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(f.calls).not.toContain("signOut");
  });
  it("any other database failure is a 500 that is reported and does not sign the person out", async () => {
    const f = fake({ rpcError: { message: "deadlock" } });
    const r = await deleteAccount({ supabase: f.client, user, input: good, verifyPassword: async () => true });
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(reportError).toHaveBeenCalled();
    expect(f.calls).not.toContain("signOut");
  });
  it("an account without an email address cannot be confirmed here", async () => {
    const r = await deleteAccount({ supabase: fake().client, user: { ...user, email: undefined } as unknown as User, input: good, verifyPassword: async () => true });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});
