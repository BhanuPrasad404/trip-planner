// Runs the three journey-intelligence migrations on a THROWAWAY in-memory Postgres (PGlite: Postgres compiled to WebAssembly) and checks them.
//
//   npm install            (once; PGlite is a pinned devDependency)
//   npm run verify:migrations
//   npm run verify:migrations -- --verbose        (also prints every step)
//
// It needs no database server, no Docker, no network (after install), and NO credentials: it never reads an environment variable, never
// opens a network connection, and never touches Supabase or any real database. Everything lives in memory and is gone when it ends.
// What it does and does not prove is written in docs/MIGRATION_VERIFICATION.md. In short: it proves the SQL runs and behaves as intended on
// real Postgres semantics against a minimal imitation of Supabase; it does NOT prove anything about real Supabase (see the document).
//
// Steps: (1) the Supabase stub; (2) existing rows that must survive; (3) apply the migrations in order; (4) apply them AGAIN (they must be safe
// to re-run); (5) run supabase/tests/journey_intelligence.test.sql, the same file CI runs on real PostGIS Postgres; (6) check the existing rows
// are untouched; (7) run each rollback script in reverse and check only the new objects went; (8) apply again from the rolled-back state.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const verbose = process.argv.includes("--verbose");
const UP = ["20261101000000_stop_progress_events", "20261102000000_trip_events_and_plan_revisions", "20261103000000_trip_commitments"];
const NEW_TABLES = ["trip_events", "trip_plan_revisions", "trip_commitments"];
const NEW_COLUMNS = ["arrived_at", "status_event_id", "status_recorded_at", "arrived_event_id"];

const results = [];
const step = (name, pass, detail = "") => { results.push({ name, pass, detail }); if (verbose || !pass) console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`); };
const guard = async (name, f) => { try { const out = await f(); step(name, out !== false, out === false ? "check returned false" : ""); } catch (e) { step(name, false, String(e && e.message ? e.message : e).slice(0, 600)); } };

const db = new PGlite();
const tables = async () => (await db.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).rows.map((r) => r.table_name);
const columns = async (t) => (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [t])).rows.map((r) => r.column_name);

await guard("the Supabase stub loads", () => db.exec(read("scripts/verify-migrations/supabase-stub.sql")));

// Existing rows that predate the migrations: they must come through untouched.
const U = "00000000-0000-4000-8000-0000000000e1", T = "10000000-0000-4000-8000-0000000000e1";
await guard("rows that exist before the migrations are created", () => db.exec(`
  insert into auth.users(id, email) values ('${U}', 'existing@example.com');
  insert into public.trips(id, owner_id, name, num_days) values ('${T}', '${U}', 'An older trip', 3);
  insert into public.trip_members(trip_id, user_id, display_name) values ('${T}', '${U}', 'Existing');
  insert into public.places(trip_id, name, lat, lng, day_number, status, status_at) values
    ('${T}', 'Done already', 17.1, 78.1, 1, 'done', '2026-10-01T10:00:00Z'), ('${T}', 'Planned', 17.2, 78.2, 1, 'planned', null), ('${T}', 'Skipped', 17.3, 78.3, 2, 'skipped', '2026-10-02T10:00:00Z');`));
const snapshot = async () => JSON.stringify((await db.query(`select name, status, status_at, day_number from public.places order by name`)).rows);
const before = await snapshot();

for (const m of UP) await guard(`apply ${m}.sql`, () => db.exec(read(`supabase/migrations/${m}.sql`)));
for (const m of UP) await guard(`apply ${m}.sql a second time (safe to re-run)`, () => db.exec(read(`supabase/migrations/${m}.sql`)));

await guard("the new tables and columns exist", async () => {
  const t = await tables(), c = await columns("places");
  return NEW_TABLES.every((x) => t.includes(x)) && NEW_COLUMNS.every((x) => c.includes(x));
});

// The same SQL test CI runs on real Postgres. `\set ON_ERROR_STOP on` is a psql command, not SQL, so it is the only line dropped.
const sqlTest = read("supabase/tests/journey_intelligence.test.sql").split("\n").filter((l) => !l.startsWith("\\")).join("\n");
await guard("supabase/tests/journey_intelligence.test.sql passes", async () => {
  const out = await db.exec(sqlTest);
  const said = JSON.stringify(out);
  if (!said.includes("ALL JOURNEY INTELLIGENCE CHECKS PASSED")) throw new Error("the test did not report that it passed");
});
await guard("the test rolled everything back (it leaves no rows behind)", async () => (await db.query(`select (select count(*) from public.trip_events) + (select count(*) from public.trip_plan_revisions) + (select count(*) from public.trip_commitments) as n`)).rows[0].n === 0);
await guard("rows that existed before are exactly as they were", async () => (await snapshot()) === before);

// Rollback: reverse order; only the new objects go; everything that existed stays.
for (const m of [...UP].reverse()) await guard(`rollback ${m}.down.sql`, () => db.exec(read(`supabase/rollback/${m}.down.sql`)));
for (const m of [...UP].reverse()) await guard(`rollback ${m}.down.sql a second time (safe to re-run)`, () => db.exec(read(`supabase/rollback/${m}.down.sql`)));
await guard("after rollback the new tables and columns are gone", async () => {
  const t = await tables(), c = await columns("places");
  return NEW_TABLES.every((x) => !t.includes(x)) && NEW_COLUMNS.every((x) => !c.includes(x));
});
await guard("after rollback the older tables and rows are intact", async () => {
  const t = await tables();
  return ["trips", "trip_members", "places"].every((x) => t.includes(x)) && (await snapshot()) === before;
});
for (const m of UP) await guard(`apply ${m}.sql again from the rolled-back state`, () => db.exec(read(`supabase/migrations/${m}.sql`)));
await guard("the SQL test passes again after a rollback and re-apply", async () => { const out = await db.exec(sqlTest); if (!JSON.stringify(out).includes("ALL JOURNEY INTELLIGENCE CHECKS PASSED")) throw new Error("not reported"); });

// Negative controls: a test that cannot fail proves nothing. In a SECOND throwaway database, weaken one protection at a time and check the
// SQL test notices. (If one of these ever "passes", the test has lost its teeth and must be fixed.)
const WEAKENINGS = {
  "members may approve a suggestion": `drop policy "Members add plan revisions" on public.trip_plan_revisions;
    create policy "Members add plan revisions" on public.trip_plan_revisions for insert to authenticated with check (public.is_trip_member(trip_id) and created_by = (select auth.uid()));`,
  "members may record an approval event": `drop policy "Members record their own trip events" on public.trip_events;
    create policy "Members record their own trip events" on public.trip_events for insert to authenticated with check (public.is_trip_member(trip_id) and user_id = (select auth.uid()));`,
  "members may rewrite history": `create policy "anyone updates events" on public.trip_events for update to authenticated using (true) with check (true);`,
  "anyone may read every trip's bookings": `create policy "anyone reads bookings" on public.trip_commitments for select to authenticated using (true);`,
  "a member may change someone else's booking": `drop policy "Author or owner edits commitments" on public.trip_commitments;
    create policy "Author or owner edits commitments" on public.trip_commitments for update to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));`,
  "the foreign-key indexes are missing": `drop index public.trip_events_place;`,
};
const TRIPS = { "members may approve a suggestion": "a member cannot approve a suggestion", "members may record an approval event": "a member cannot record an approval", "members may rewrite history": "history cannot be rewritten", "anyone may read every trip's bookings": "reads none", "a member may change someone else's booking": "cannot rewrite someone else", "the foreign-key indexes are missing": "the expected indexes exist" };
for (const [what, sql] of Object.entries(WEAKENINGS)) {
  await guard(`control: the SQL test FAILS when ${what}`, async () => {
    const c = new PGlite();
    await c.exec(read("scripts/verify-migrations/supabase-stub.sql"));
    for (const m of UP) await c.exec(read(`supabase/migrations/${m}.sql`));
    await c.exec(sql);
    try { await c.exec(sqlTest); } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes(TRIPS[what])) return true;
      throw new Error(`it failed, but not on the expected check (${TRIPS[what]}): ${msg.slice(0, 200)}`);
    }
    throw new Error("the test still passed with this protection removed");
  });
}

const bad = results.filter((r) => !r.pass);
console.log(`\nverify:migrations: ${results.length - bad.length} of ${results.length} steps passed${bad.length ? `, ${bad.length} FAILED` : ""}.`);
console.log("This checks the SQL on PGlite with a minimal Supabase stub. It is not a test of real Supabase: see docs/MIGRATION_VERIFICATION.md.");
process.exit(bad.length ? 1 : 0);
