// Audit probe: asserts the CORRECT security behaviour. A failing test here = a confirmed defect (see the audit report).
// SQL policies cannot run in vitest, so the database checks read the migration text and assert the protection is present.
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { safeNextPath } from "@/lib/safe-redirect";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
import { POST as clientErrorPOST } from "@/app/api/client-error/route";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const allSql = readdirSync(new URL("supabase/migrations/", root)).sort().map((f) => read(`supabase/migrations/${f}`)).join("\n");

describe("open redirect (?next=)", () => {
  // The browser's URL parser silently deletes tab/newline characters, so "/<TAB>/evil.com" is really "//evil.com".
  // AuthForm does router.push(next) with this value after login.
  it.each(["/\t/evil.com", "/\t\\evil.com", "//evil.com", "/\\evil.com", "/\n/evil.com"])("%j never leaves the site", (raw) => {
    const safe = safeNextPath(raw);
    expect(new URL(safe, "https://trailmate.app").origin).toBe("https://trailmate.app");
  });
});

describe("POST /api/client-error (unauthenticated)", () => {
  it("an opaque Origin ('null', sent by sandboxed frames/file pages) is refused, not a crash", async () => {
    const req = new Request("https://trailmate.app/api/client-error", { method: "POST", headers: { host: "trailmate.app", origin: "null", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ kind: "k", message: "m" }) });
    const res = await clientErrorPOST(req).catch(() => null);
    expect(res, "route threw (would be an unhandled 500)").not.toBeNull();
    expect(res!.status).toBe(403);
  });
});

describe("database: trip membership", () => {
  it("a member cannot move their own membership row into another trip (trip_id must be immutable)", () => {
    const policy = /create policy "Members can edit own profile"[\s\S]*?;/.exec(allSql)![0];
    const guarded = /trip_members[\s\S]{0,400}(before update|revoke update|grant update \(display_name|trip_id\s*=\s*old\.trip_id|new\.trip_id\s*:=\s*old\.trip_id)/i.test(allSql) || /exists \(select 1 from public\.trip_members[^)]*trip_id = trip_id/i.test(policy);
    expect(guarded, "UPDATE policy only checks user_id; PATCH trip_members {trip_id: <any trip uuid>} grants membership without an invite").toBe(true);
  });
  it("a member cannot rewrite joined_at (the account-deletion heir is the longest-standing member)", () => {
    expect(/trip_members[\s\S]{0,400}joined_at\s*:=\s*old\.joined_at|grant update \(display_name, avatar_color\)/i.test(allSql)).toBe(true);
  });
});

describe("database: invites", () => {
  // The LATEST definition counts (a later migration replaces the function).
  const latest = (name: string) => [...allSql.matchAll(new RegExp(String.raw`create or replace function public\.${name}[\s\S]*?\$\$;`, "g"))].at(-1)![0];
  const join = latest("join_trip_by_code");
  it("FIXED (20261023000000): invite links can expire or be revoked", () => {
    expect(/invite_expires_at|invite_revoked|regenerate_invite|invite_code\s*=\s*substr/i.test(allSql.replace(/alter column invite_code set default[^;]*;/i, "")) || /expires|revoked/i.test(join)).toBe(true);
  });
  it.fails("OPEN P2: legacy 8-character invite codes are replaced by the 12-character default", () => {
    expect(/update public\.trips\s+set invite_code/i.test(allSql)).toBe(true);
  });
  it("FIXED (20261023000000): code guessing is throttled (join_trip_by_code is callable directly through PostgREST)", () => {
    // The old entry point now goes through join_trip_with_invite, which counts failed attempts per person.
    expect(join).toMatch(/join_trip_with_invite/);
    expect(latest("join_trip_with_invite")).toMatch(/invite_attempts[\s\S]*v_failures >= 10/);
  });
});

describe("database: social tables", () => {
  it("post_media.poster_path must be inside the author's own folder (it is a second read-grant path in storage policy)", () => {
    const ins = [...allSql.matchAll(/create policy "Add media to own posts"[\s\S]*?;/g)].pop()![0];
    expect(/poster_path/.test(ins)).toBe(true);
  });
  it("a followee approving a request cannot rewrite follower_id/followee_id (forced follows)", () => {
    const upd = /create policy "Approve requests to me"[\s\S]*?;/.exec(allSql)![0];
    expect(/before update on public\.follows|follower_id\s*=\s*old\.follower_id|grant update \(status\)/i.test(allSql) || /follower_id/.test(upd.split("with check")[1] ?? "")).toBe(true);
  });
  it.fails("OPEN P2: posts INSERT cannot pick an arbitrary destination_id / skip resolve_destination", () => {
    const trg = /create or replace function public\.posts_before_write\(\)[\s\S]*?end \$\$;/g;
    const last = [...allSql.matchAll(trg)].pop()![0];
    const insertBranch = /if tg_op = 'INSERT' then([\s\S]*?)else/.exec(last)![1];
    expect(/destination_id/.test(insertBranch)).toBe(true);
  });
});

describe("storage / account deletion", () => {
  it.fails("OPEN P3: report-photos has an owner SELECT policy so deletion can list leftover uploads (collectUploadPaths -> list())", () => {
    const sql = read("supabase/migrations/20261009000200_report_photos_bucket.sql");
    expect(/for select to authenticated/i.test(sql)).toBe(true);
  });
});

describe("rate limiting of expensive write routes (a rate limiter or quota must be on the route)", () => {
  // These call a third-party routing service (getMatrix) per request.
  it.each(["app/api/trips/[id]/optimize/route.ts", "app/api/trips/[id]/replan/route.ts"])("%s", (p) => {
    expect(/rateLimiter\.take|consumeQuota/.test(read(p))).toBe(true);
  });
  it.each(["app/api/trips/route.ts", "app/api/places/route.ts", "app/api/places/bulk/route.ts", "app/api/profile/route.ts", "app/api/reports/[id]/flag/route.ts"])("%s", (p) => {
    expect(/rateLimiter\.take|consumeQuota/.test(read(p))).toBe(true);
  });
});

describe("every API route authenticates (or is secret-gated)", () => {
  const routes = (function walk(d: URL): string[] {
    return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : e.name === "route.ts" ? [new URL(e.name, d).pathname] : []));
  })(new URL("app/api/", root));
  it("found routes", () => expect(routes.length).toBeGreaterThan(40));
  // Public ON PURPOSE: the connectivity probe has to work with no sign-in (and when the session service itself is unreachable). It is only
  // allowed to stay public while it is provably inert: no imports at all (so no database, no secrets, no user data), a 204, never cached.
  const PUBLIC_BY_DESIGN = new Set(["ping/route.ts"]);
  // Open to signed-out visitors ON PURPOSE (trip creation, phase 1: "search and reverse lookup must also work for guests, limited per
  // visitor"). Each must identify the visitor (signed-in user, or a hashed random cookie + hashed network), apply the per-minute limit,
  // validate its input, set the visitor cookie, and never use the service-role key itself (guest daily limits go through
  // lib/places/visitor.ts, which only calls one locked-down database function).
  const GUEST_ROUTES = new Set(["place-search/route.ts", "place-here/route.ts", "place-suggest/route.ts", "intake/read/route.ts", "intake/ai/route.ts", "intake/roads/route.ts", "intake/season/route.ts", "intake/similar/route.ts", "poll/[code]/route.ts"]);
  it.each(routes.map((p) => [p.split("/app/api/")[1], p] as const))("%s", (n, p) => {
    const src = readFileSync(decodeURIComponent(p).replace(/^\/([A-Za-z]:)/, "$1"), "utf8");
    if (GUEST_ROUTES.has(n)) {
      expect(src).toContain("await identify(req)");
      expect(src).toMatch(/rateLimiter\.take\(`[a-z-]+:\$\{burstKey\(visitor\)\}`/);
      expect(src).toMatch(/parseBody\(req, (?:place|intake|group)[A-Za-z]+Schema\)/);
      expect(src).toContain("rememberVisitor(");
      expect(/supabase\/admin|SERVICE_ROLE|createAdminClient/.test(src)).toBe(false);
      return;
    }
    if (PUBLIC_BY_DESIGN.has(n)) {
      expect(/^\s*import\s/m.test(src), "a public route must import nothing").toBe(false);
      expect(/require\(|fetch\(|process\.env|supabase|cookies\(|headers\(/i.test(src)).toBe(false);
      expect(src).toContain("status: 204"); expect(src).toContain("no-store");
      return;
    }
    expect(/auth\.getUser\(|INGEST_SECRET|Origin check|origin/.test(src)).toBe(true);
  });
});
