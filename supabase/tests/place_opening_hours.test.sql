-- Real-database test for 20261018000000_place_opening_hours.sql: who confirmed a stop's opening hours is recorded by the database,
-- cannot be forged by a member, survives unrelated edits, and is cleared when the hours change or are removed.
-- Run on a scratch database with every migration applied (see supabase/tests/bootstrap.sql and scripts/db-replay.sh).
-- Prints "ALL OPENING HOURS CHECKS PASSED"; any failure raises. Everything happens inside a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'cara@example.com'),
  ('bbbbbbbb-0000-4000-8000-0000000000c2', 'dev@example.com');
insert into public.trips (id, owner_id, name, num_days, invite_code) values
  ('11111111-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'Hours test', 1, 'inv-hours-c1');
insert into public.trip_members (trip_id, user_id, display_name) values
  ('11111111-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'Cara'),
  ('11111111-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-0000000000c2', 'Dev')
on conflict do nothing;
insert into public.places (id, trip_id, name, lat, lng, day_number) values
  ('22222222-0000-4000-8000-0000000000c1', '11111111-0000-4000-8000-0000000000c1', 'Fort', 17.5, 78.9, 1);

-- As Cara, a member.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000c1', true);
set local role authenticated;

do $$
declare r record;
begin
  -- 1. Map data arrives unconfirmed, even if the writer tries to claim it was confirmed by someone else.
  update public.places set opening_hours = 'Mo-Su 09:00-17:30', hours_source = 'map_data', hours_ref = 'osm/way/42',
         hours_confirmed_at = null, hours_confirmed_by = 'bbbbbbbb-0000-4000-8000-0000000000c2'
   where id = '22222222-0000-4000-8000-0000000000c1';
  select * into r from public.places where id = '22222222-0000-4000-8000-0000000000c1';
  if r.hours_confirmed_by is not null or r.hours_confirmed_at is not null then raise exception 'unconfirmed hours must have no confirmer'; end if;

  -- 2. Confirming records THIS session's user, whatever the request says.
  update public.places set hours_confirmed_at = '2000-01-01', hours_confirmed_by = 'bbbbbbbb-0000-4000-8000-0000000000c2'
   where id = '22222222-0000-4000-8000-0000000000c1';
  select * into r from public.places where id = '22222222-0000-4000-8000-0000000000c1';
  if r.hours_confirmed_by <> 'aaaaaaaa-0000-4000-8000-0000000000c1' then raise exception 'confirmer must be the session user'; end if;
  if r.hours_confirmed_at < now() - interval '1 minute' then raise exception 'confirmation time must be set by the database'; end if;

  -- 3. An unrelated edit (moving the stop) keeps the confirmation and cannot rewrite who confirmed.
  update public.places set day_number = null, hours_confirmed_by = 'bbbbbbbb-0000-4000-8000-0000000000c2'
   where id = '22222222-0000-4000-8000-0000000000c1';
  select * into r from public.places where id = '22222222-0000-4000-8000-0000000000c1';
  if r.hours_confirmed_by <> 'aaaaaaaa-0000-4000-8000-0000000000c1' then raise exception 'unrelated edit must not change the confirmer'; end if;

  -- 4. A map-data refresh that writes new text unconfirmed clears the old confirmation.
  update public.places set opening_hours = 'Mo-Su 10:00-17:00', hours_confirmed_at = null where id = '22222222-0000-4000-8000-0000000000c1';
  select * into r from public.places where id = '22222222-0000-4000-8000-0000000000c1';
  if r.hours_confirmed_at is not null or r.hours_confirmed_by is not null then raise exception 'new unconfirmed text must clear the confirmation'; end if;

  -- 5. Removing the hours removes everything about them.
  update public.places set opening_hours = null where id = '22222222-0000-4000-8000-0000000000c1';
  select * into r from public.places where id = '22222222-0000-4000-8000-0000000000c1';
  if r.hours_source is not null or r.hours_ref is not null or r.hours_fetched_at is not null then raise exception 'cleared hours must leave no source'; end if;

  -- 6. Constraints: no hours without a source, no unknown source, no over-long text.
  begin
    update public.places set opening_hours = '24/7', hours_source = null where id = '22222222-0000-4000-8000-0000000000c1';
    raise exception 'hours without a source were accepted';
  exception when check_violation then null; end;
  begin
    update public.places set opening_hours = '24/7', hours_source = 'google' where id = '22222222-0000-4000-8000-0000000000c1';
    raise exception 'an unknown hours source was accepted';
  exception when check_violation then null; end;
  begin
    update public.places set opening_hours = repeat('x', 256), hours_source = 'traveller' where id = '22222222-0000-4000-8000-0000000000c1';
    raise exception 'over-long hours were accepted';
  exception when check_violation then null; end;
end $$;

-- 7. A non-member cannot see or change the stop's hours (existing places RLS).
select set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-0000000000c3', true);
do $$
declare n int;
begin
  update public.places set opening_hours = '24/7', hours_source = 'traveller' where id = '22222222-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a non-member changed a stop''s hours'; end if;
end $$;

select 'ALL OPENING HOURS CHECKS PASSED';
rollback;
