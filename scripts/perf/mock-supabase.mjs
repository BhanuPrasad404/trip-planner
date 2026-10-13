// DEV-ONLY measuring rig: a fake Supabase (Auth + PostgREST) with a controllable delay per request, so page load chains can be
// measured on a laptop. It answers with fixed fixtures and logs every call with timestamps (GET /__log, POST /__reset).
// Run through scripts/perf/run.mjs. Not used by the app.
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 54399);
const LATENCY = Number(process.env.SUPA_LATENCY_MS ?? 150);
const ALG = process.env.JWT_ALG ?? "ES256"; // ES256 = verified locally; HS256 = Supabase's legacy secret (every check is a network call)

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const start = new Date(today.getTime() - 86_400_000);
const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "perf@example.com", user_metadata: { display_name: "Perf" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const trip = { id: TRIP_ID, owner_id: USER_ID, name: "Vizag run", start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: "Visakhapatnam", dest_lat: 17.6868, dest_lng: 83.2185, start_date: iso(start), num_days: 3, invite_code: "abc", created_at: "2026-10-01T00:00:00Z" };
const places = Array.from({ length: 12 }, (_, i) => ({ id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`, trip_id: TRIP_ID, name: `Stop ${i + 1}`, lat: 17.4 + i * 0.1, lng: 78.5 + i * 0.4, source_type: "manual", source_url: null, season_tag_id: null, day_number: (i % 3) + 1, sequence_order: Math.floor(i / 3) + 1, arrival_time: null, notes: null, category: "viewpoint", status: "planned", status_at: null, address: null, drive_minutes: null, drive_km: null, added_by: USER_ID, created_at: "2026-10-01T00:00:00Z", season_tags: { good_months: [10, 11], reason: "dry", category: "viewpoint" } }));
const members = [{ id: "44444444-4444-4444-8444-444444444444", trip_id: TRIP_ID, user_id: USER_ID, display_name: "Perf", avatar_color: "#1C7C6D", joined_at: "2026-10-01T00:00:00Z" }];
const TABLES = { trips: [trip], places, trip_members: members, place_votes: [], place_reports: [], profiles: [{ id: USER_ID, display_name: "Perf" }], posts: [], notifications: [] };

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "perf-key", alg: "ES256", use: "sig" };
const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
function signJwt(payload) {
  if (ALG === "HS256") { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload); return `${h}.${p}.${crypto.createHmac("sha256", "secret").update(`${h}.${p}`).digest("base64url")}`; }
  const h = b64({ alg: "ES256", typ: "JWT", kid: "perf-key" }), p = b64(payload);
  return `${h}.${p}.${crypto.sign("sha256", Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
function sessionCookie(port) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJwt({ sub: USER_ID, aud: "authenticated", role: "authenticated", email: user.email, exp: now + 36_000, iat: now, session_id: "s1" });
  const session = { access_token: access, refresh_token: "r", expires_in: 36_000, expires_at: now + 36_000, token_type: "bearer", user };
  return { name: "sb-127-auth-token", value: `base64-${b64(session)}`, port };
}

let log = [];
const server = http.createServer((req, res) => {
  const t0 = performance.now();
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/__log") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(log)); }
  if (url.pathname === "/__reset") { log = []; return res.end("ok"); }
  if (url.pathname === "/__cookie") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(sessionCookie(PORT))); }
  const entry = { at: Math.round(Date.now() % 1e9), method: req.method, path: `${url.pathname}${url.search}`.slice(0, 110) };
  setTimeout(() => {
    res.setHeader("content-type", "application/json");
    const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (url.pathname.endsWith("/.well-known/jwks.json")) res.end(JSON.stringify({ keys: [jwk] }));
    else if (url.pathname === "/auth/v1/user") res.end(JSON.stringify(user));
    else if (url.pathname.startsWith("/rest/v1/")) {
      // Understand simple equality filters (?id=eq.…, ?trip_id=eq.…) so single-row lookups behave like the real thing.
      let rows = TABLES[url.pathname.slice("/rest/v1/".length)] ?? [];
      for (const [k, v] of url.searchParams) if (typeof v === "string" && v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      if (wantsObject) { if (rows.length === 0) { res.statusCode = 406; res.end(JSON.stringify({ code: "PGRST116", message: "no rows" })); } else res.end(JSON.stringify(rows[0])); }
      else res.end(JSON.stringify(rows));
    } else { res.statusCode = 404; res.end("{}"); }
    entry.ms = Math.round(performance.now() - t0);
    log.push(entry);
  }, LATENCY);
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT} (latency ${LATENCY} ms, ${ALG})`));
export { TRIP_ID };
