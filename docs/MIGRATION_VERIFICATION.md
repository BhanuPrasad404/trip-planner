# Verifying the journey-intelligence migrations

Three migrations add the journey history, plan revisions and bookings:

| Migration | Adds |
|---|---|
| `20261101000000_stop_progress_events.sql` | four nullable columns on `places` (arrival time, event ids) |
| `20261102000000_trip_events_and_plan_revisions.sql` | `trip_events` (append-only journey history) and `trip_plan_revisions` (original, proposed, approved, declined plans) |
| `20261103000000_trip_commitments.sql` | `trip_commitments` (bookings, entered by travellers) |

All three are additive (nothing existing is changed or deleted) and are safe to run twice. The app works without them: it records the real
action time, catches conflicts, and says plainly that history, plan changes and bookings "can't be saved yet".

**None of them has been applied to any Supabase database.** Applying them needs the owner's separate approval.

## Run the check yourself

```
npm ci --legacy-peer-deps     # once; installs the pinned dev dependency @electric-sql/pglite
npm run verify:migrations     # about 10 seconds
npm run verify:migrations -- --verbose    # also prints every step
```

Needs: Node 20 or newer. Does **not** need: a database server, Docker, Supabase, network access (after install), environment variables or any
credential. The script never reads an environment variable and never opens a connection; everything is in memory and gone when it ends.
Exit code 0 means every step passed; 1 means something failed (the failing step is printed).

## Checked on a clean copy

The script was run from a clean copy of the project (no `node_modules`, no `.next`), after `npm ci --legacy-peer-deps`, and passed all 30 steps. It
also passed with production-looking variables set (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`):
none is read or needed, and nothing connects anywhere. **Known quirk:** PGlite aborts ("Aborted()") if the process has a completely empty
environment (for example `env -i node ...`); run it from an ordinary shell. The cause was not investigated further.

## What it does

It starts PGlite (Postgres compiled to WebAssembly), then:

1. loads `scripts/verify-migrations/supabase-stub.sql`: a minimal imitation of Supabase (the `auth` schema and `auth.uid()`, the `anon` /
   `authenticated` / `service_role` roles, Supabase's default table grants, the two membership helpers, and `trips`, `trip_members`, `places`);
2. creates rows that **existed before** the migrations (including a done and a skipped stop);
3. applies the three migrations in order, then applies them **again** (they must be safe to re-run);
4. runs `supabase/tests/journey_intelligence.test.sql`, **the same file CI runs on real PostGIS Postgres** (see below);
5. checks the pre-existing rows are exactly as they were;
6. runs each `supabase/rollback/*.down.sql` in reverse order (twice), and checks only the new tables and columns went and everything older is intact;
7. applies the migrations again from the rolled-back state and re-runs the SQL test;
8. **negative controls**: in a second throwaway database it weakens one protection at a time (members may approve, members may record an
   approval event, members may rewrite history, anyone may read bookings, a member may edit someone else's booking, the foreign-key indexes are
   missing) and checks the SQL test fails *on the check that protects it*. A test that cannot fail proves nothing.

## What the SQL test checks

Constraints (allowed kinds and sources, id and meta shapes, negative accuracy, booking windows and days), uniqueness (a retried event or a
revision number taken twice is refused), Row Level Security (members read their trip's rows; outsiders read and write nothing; nobody records
a row **as someone else**; anonymous visitors get nothing), **owner-only decisions** (a member can suggest a change but cannot approve,
decline or undo one, nor record an approval event; the owner can), **append-only** history (no update or delete, even by the owner), that
bookings can only be changed or removed by their author or the trip owner, that deleting a stop keeps its history and its booking (the link is
cleared, nothing is deleted), that deleting an account removes that person's own journey history (and no one else's) while the trip's plan
revisions and bookings stay, that every row-level-security table has RLS on, and that the expected indexes exist.

## What it does NOT verify

- **Real Supabase.** The stub is deliberately small. Real Supabase has more roles, extensions, triggers, event triggers, realtime publications
  and a different `auth` implementation. A pass here is not a pass there.
- **Real tokens.** `auth.uid()` is faked with a session setting; real JWT handling, refresh and expiry are not exercised.
- **Existing production data.** Only a few invented rows. Run the migrations against a copy of real data on staging to see real volumes and any
  odd rows.
- **Performance and locking.** The tables are new and empty, so there is no lock risk, but nothing here measures query plans at scale.
- **The application.** The API routes and screens are tested by `npm test` with in-memory fakes of the database (see "What is a real database
  test" below), not by this script.
- **Interaction with every other migration.** PGlite has no PostGIS, so the older migrations are not replayed here. CI does that (below).

## The real-database check that already exists: CI

`.github/workflows/ci.yml` has a `database` job that starts a PostGIS Postgres, replays **every** migration in `supabase/migrations` with
`scripts/db-replay.sh`, and runs every `supabase/tests/*.test.sql`, including `journey_intelligence.test.sql`. That is the check that includes
the older migrations on real Postgres. To run it yourself you need Postgres with PostGIS:

```
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/db-replay.sh
```

(`scripts/db-replay.sh` drops and recreates a database named `scratch` on the server you point it at. Never point it at a real database.)

## Rolling back

`supabase/rollback/*.down.sql` undo each migration. The Supabase CLI ignores that folder; run them by hand, in **reverse** order (1103, 1102,
1101), and only if needed. They are **destructive** for the data the new tables hold (the original itinerary snapshots cannot be rebuilt), so
each file says what to export first. They are safe to run twice, and the app keeps working with the tables gone.

## What is a real database test, and what is not

| Kind | Where | Real database? |
|---|---|---|
| SQL tests (`supabase/tests/*.test.sql`) | CI on PostGIS Postgres; `npm run verify:migrations` on PGlite | **Yes** (PGlite: real Postgres, stubbed Supabase) |
| API route tests (`tests/*-route*.test.ts`, `tests/progress-*.ts`) | `npm test` | No: an in-memory fake that imitates filters, unique keys and missing tables |
| Hook and screen tests (`tests/*client*.tsx`, `tests/phase5-ui.test.tsx`) | `npm test` | No: fake network and storage, static markup |
| Phone-width test (`tests/phone-width.test.ts`) | `npm test` (needs a build and Chrome) | No database; a real browser measuring the real built CSS |

The fakes are useful (they pin the app's own rules) but cannot catch a mistake in the SQL or a policy; that is what the SQL test is for.

## Suggested order when the owner approves staging

1. Back up the staging database.
2. Apply the three migrations in order with the Supabase CLI.
3. Run `supabase/tests/journey_intelligence.test.sql` against staging (it rolls itself back), or let CI do it.
4. Sign in with two real accounts (owner and member) and try: leave and pause, arrive, suggest a change as the member, approve it as the owner,
   undo, add a booking and try to move it as the other member.
5. Only then production.
