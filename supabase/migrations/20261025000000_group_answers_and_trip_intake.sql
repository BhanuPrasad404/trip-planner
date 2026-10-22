-- Trip creation, phase 2: "Ask your group" answers, and what the traveller told us about the trip.
--
--   trips.intake          the planner's inputs from the guided flow (who, how, pace, driving limit, night driving, interests, stay, avoid),
--                         a small JSON object. NULL for trips made before this (they plan exactly as before).
--   trips.poll_code       a random code for the group's answer link. NOT the invite code: answering never makes anyone a member.
--   trips.poll_open       the owner can switch the link off at any time (answers stay; the link stops accepting new ones).
--   trip_group_answers    one row per person who answered: a signed-in member (user_id) or a guest (visitor_key = an HMAC of a random
--                         cookie, never the cookie itself). Name typed by them, and their answers (pace, interests, things to avoid).
--   Functions (all check who is asking):
--     set_trip_poll(trip, open, new_code)  owner: switch the link on/off, or make a new link (the old one stops working at once)
--     poll_lookup(code)                    anyone: the trip's name and whether it accepts answers — nothing else
--     submit_group_answer(code, name, answers)                  a signed-in person, as themselves
--     submit_guest_group_answer(code, visitor_key, name, answers)   our server only (service role), for a guest
--     my_group_answer(code) / guest_group_answer(code, visitor_key)   your own answer, to show and change it on the same phone
--     remove_group_answer(answer)          owner
--
-- ADDITIVE ONLY: new columns, one new table, new functions. Nothing existing is renamed, changed or dropped. Safe to re-run.

-- 1. Trip columns ------------------------------------------------------------------------------------------------------------------
alter table public.trips add column if not exists intake jsonb;
alter table public.trips add column if not exists poll_code text;
alter table public.trips add column if not exists poll_open boolean not null default false;
create unique index if not exists trips_poll_code_unique on public.trips (poll_code) where poll_code is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trips_intake_shape' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_intake_shape check (intake is null or (jsonb_typeof(intake) = 'object' and pg_column_size(intake) <= 8192));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trips_poll_code_shape' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_poll_code_shape check (poll_code is null or poll_code ~ '^[a-f0-9]{16}$');
  end if;
end $$;

-- 2. Answers -----------------------------------------------------------------------------------------------------------------------
create table if not exists public.trip_group_answers (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  visitor_key  text check (visitor_key is null or char_length(visitor_key) between 16 and 64),
  display_name text not null check (char_length(display_name) between 1 and 40),
  answers      jsonb not null check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 2048),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trip_group_answers_one_identity check ((user_id is null) <> (visitor_key is null))
);
create unique index if not exists trip_group_answers_user on public.trip_group_answers (trip_id, user_id) where user_id is not null;
create unique index if not exists trip_group_answers_visitor on public.trip_group_answers (trip_id, visitor_key) where visitor_key is not null;
create index if not exists trip_group_answers_trip on public.trip_group_answers (trip_id, created_at);

alter table public.trip_group_answers enable row level security;
revoke all on public.trip_group_answers from anon;
drop policy if exists "Trip members read group answers" on public.trip_group_answers;
create policy "Trip members read group answers" on public.trip_group_answers
  for select to authenticated using (public.is_trip_member(trip_id));
-- No insert/update/delete policies: writes only through the functions below.

-- 3. Functions ---------------------------------------------------------------------------------------------------------------------
create or replace function public.set_trip_poll(p_trip uuid, p_open boolean, p_new_code boolean default false)
returns table (poll_code text, poll_open boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  v_code text;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select t.poll_code into v_code from public.trips t where t.id = p_trip and t.owner_id = uid for update;
  if not found then raise exception 'Only the trip owner can share or stop the group link' using errcode = '42501'; end if;
  if p_new_code or (p_open and v_code is null) then
    loop
      v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      begin
        update public.trips t set poll_code = v_code where t.id = p_trip;
        exit;
      exception when unique_violation then -- astronomically unlikely; draw again
      end;
    end loop;
  end if;
  update public.trips t set poll_open = p_open where t.id = p_trip;
  return query select v_code, p_open;
end $$;
revoke all on function public.set_trip_poll(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_trip_poll(uuid, boolean, boolean) to authenticated;

create or replace function public.poll_lookup(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when t.id is null then jsonb_build_object('status', 'invalid')
    when not t.poll_open then jsonb_build_object('status', 'closed', 'trip_name', t.name)
    else jsonb_build_object('status', 'open', 'trip_name', t.name, 'answers', (select count(*) from public.trip_group_answers a where a.trip_id = t.id))
  end
  from (select 1) one left join public.trips t on t.poll_code = p_code and p_code ~ '^[a-f0-9]{16}$';
$$;
revoke all on function public.poll_lookup(text) from public;
grant execute on function public.poll_lookup(text) to anon, authenticated, service_role;

-- The one place an answer is saved. Not callable by anyone directly: only through the two wrappers below, which decide WHO is answering
-- by database permission (never by a claim inside the request): signed-in people answer as themselves; a guest's answer can only come
-- from our server (service role), which passes the hashed visitor key.
create or replace function public._save_group_answer(uid uuid, p_visitor_key text, p_code text, p_name text, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_trip uuid;
  v_open boolean;
  v_count int;
  v_mine uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if (uid is null) = (p_visitor_key is null) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_visitor_key is not null and (char_length(p_visitor_key) < 16 or char_length(p_visitor_key) > 64) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then return jsonb_build_object('status', 'bad_name'); end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 2048 then return jsonb_build_object('status', 'bad_answers'); end if;

  select t.id, t.poll_open into v_trip, v_open from public.trips t where t.poll_code = p_code and p_code ~ '^[a-f0-9]{16}$';
  if v_trip is null then return jsonb_build_object('status', 'invalid'); end if;
  if not v_open then return jsonb_build_object('status', 'closed'); end if;

  perform pg_advisory_xact_lock(hashtextextended('poll:' || v_trip::text, 0));
  select a.id into v_mine from public.trip_group_answers a where a.trip_id = v_trip and ((uid is not null and a.user_id = uid) or (p_visitor_key is not null and a.visitor_key = p_visitor_key));
  if v_mine is not null then
    update public.trip_group_answers set display_name = v_name, answers = p_answers, updated_at = now() where id = v_mine;
    return jsonb_build_object('status', 'updated', 'id', v_mine);
  end if;
  select count(*) into v_count from public.trip_group_answers a where a.trip_id = v_trip;
  if v_count >= 30 then return jsonb_build_object('status', 'full'); end if;
  insert into public.trip_group_answers (trip_id, user_id, visitor_key, display_name, answers)
  values (v_trip, uid, p_visitor_key, v_name, p_answers) returning id into v_mine;
  return jsonb_build_object('status', 'saved', 'id', v_mine);
end $$;
revoke all on function public._save_group_answer(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- Signed in: answer as yourself.
create or replace function public.submit_group_answer(p_code text, p_name text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return public._save_group_answer(uid, null, p_code, p_name, p_answers);
end $$;
revoke all on function public.submit_group_answer(text, text, jsonb) from public, anon;
grant execute on function public.submit_group_answer(text, text, jsonb) to authenticated;

-- A guest, through our server only.
create or replace function public.submit_guest_group_answer(p_code text, p_visitor_key text, p_name text, p_answers jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select public._save_group_answer(null, p_visitor_key, p_code, p_name, p_answers);
$$;
revoke all on function public.submit_guest_group_answer(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_guest_group_answer(text, text, text, jsonb) to service_role;

-- Your own answer (to show and change it). Signed in: by account. Guest: by visitor key, through our server only.
create or replace function public.my_group_answer(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', a.display_name, 'answers', a.answers)
    from public.trip_group_answers a join public.trips t on t.id = a.trip_id
   where t.poll_code = p_code and a.user_id = (select auth.uid());
$$;
revoke all on function public.my_group_answer(text) from public, anon;
grant execute on function public.my_group_answer(text) to authenticated;

create or replace function public.guest_group_answer(p_code text, p_visitor_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', a.display_name, 'answers', a.answers)
    from public.trip_group_answers a join public.trips t on t.id = a.trip_id
   where t.poll_code = p_code and a.visitor_key = p_visitor_key;
$$;
revoke all on function public.guest_group_answer(text, text) from public, anon, authenticated;
grant execute on function public.guest_group_answer(text, text) to service_role;

create or replace function public.remove_group_answer(p_answer uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from public.trip_group_answers a using public.trips t where a.id = p_answer and t.id = a.trip_id and t.owner_id = uid;
  return found;
end $$;
revoke all on function public.remove_group_answer(uuid) from public, anon;
grant execute on function public.remove_group_answer(uuid) to authenticated;
