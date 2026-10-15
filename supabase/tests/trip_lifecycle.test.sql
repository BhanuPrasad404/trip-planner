-- Real-database test for 20261021000000_trip_lifecycle.sql: the lifecycle columns are optional, validated, and independent of the
-- planned dates and the stops. Run on a scratch database with every migration applied (see scripts/db-replay.sh).
-- Prints "ALL TRIP LIFECYCLE CHECKS PASSED"; any failure raises. Everything happens in a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-0000000000f1', 'owner@example.com');
insert into public.trips (id, owner_id, name, num_days, start_date, invite_code) values
  ('11111111-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-0000000000f1', 'Old plan', 2, '2026-10-01', 'inv-f1');
insert into public.places (id, trip_id, name, lat, lng, day_number, status) values
  ('22222222-0000-4000-8000-0000000000f1', '11111111-0000-4000-8000-0000000000f1', 'Fort', 17.4, 78.5, 1, 'done'),
  ('22222222-0000-4000-8000-0000000000f2', '11111111-0000-4000-8000-0000000000f1', 'Lake', 17.5, 78.6, 2, 'planned');

do $$
declare denied boolean; t record; n int;
begin
  -- 1. Existing trips are untouched: all four columns are null.
  select * into t from public.trips where id = '11111111-0000-4000-8000-0000000000f1';
  if t.resumed_at is not null or t.closed_at is not null or t.closed_reason is not null or t.resume_day_end_min is not null then raise exception 'existing trips must have no lifecycle values'; end if;

  -- 2. Resuming records the decision and leaves the PLANNED dates and every stop exactly as they were.
  update public.trips set resumed_at = now(), resume_day_end_min = 1290 where id = t.id;
  select * into t from public.trips where id = t.id;
  if t.start_date <> '2026-10-01' or t.num_days <> 2 then raise exception 'resuming must not change the planned dates'; end if;
  select count(*) into n from public.places where trip_id = t.id and ((name = 'Fort' and status = 'done') or (name = 'Lake' and status = 'planned'));
  if n <> 2 then raise exception 'resuming must not change any stop or its progress'; end if;

  -- 3. A trip is closed for a stated reason or not at all: never half of each.
  denied := false;
  begin update public.trips set closed_at = now() where id = t.id; exception when check_violation then denied := true; end;
  if not denied then raise exception 'closed_at without a reason must be rejected'; end if;
  denied := false;
  begin update public.trips set closed_reason = 'finished' where id = t.id; exception when check_violation then denied := true; end;
  if not denied then raise exception 'a reason without closed_at must be rejected'; end if;
  denied := false;
  begin update public.trips set closed_at = now(), closed_reason = 'abandoned' where id = t.id; exception when check_violation then denied := true; end;
  if not denied then raise exception 'an unknown reason must be rejected'; end if;

  -- 4. Finishing and calling off are accepted; closing keeps the stops; reopening clears both together.
  update public.trips set closed_at = now(), closed_reason = 'finished' where id = t.id;
  update public.trips set closed_reason = 'cancelled' where id = t.id;
  select count(*) into n from public.places where trip_id = t.id;
  if n <> 2 then raise exception 'closing a trip must keep its stops'; end if;
  update public.trips set closed_at = null, closed_reason = null where id = t.id;
  select * into t from public.trips where id = t.id;
  if t.closed_at is not null or t.closed_reason is not null then raise exception 'reopening must clear both'; end if;
  if t.resumed_at is null then raise exception 'reopening must keep the earlier resume'; end if;

  -- 5. The time budget is a time of day.
  denied := false;
  begin update public.trips set resume_day_end_min = 1440 where id = t.id; exception when check_violation then denied := true; end;
  if not denied then raise exception 'a day end past midnight must be rejected'; end if;
  denied := false;
  begin update public.trips set resume_day_end_min = -5 where id = t.id; exception when check_violation then denied := true; end;
  if not denied then raise exception 'a negative day end must be rejected'; end if;
  update public.trips set resume_day_end_min = 0 where id = t.id;
  update public.trips set resume_day_end_min = 1439 where id = t.id;
end $$;

rollback;
\echo ALL TRIP LIFECYCLE CHECKS PASSED
