-- Invite links: a NEW link on demand (the old one stops working at once), an optional expiry, and throttled joining.
--
--   trips.invite_expires_at          optional; null = the link never expires.
--   rotate_trip_invite(trip, hours)  owner only: a brand-new 16-character random code, with an optional expiry. The old code no
--                                    longer exists anywhere, so it stops working the moment this runs. People who already
--                                    joined stay members.
--   join_trip_with_invite(code)      joins and returns a STATUS (joined / already_member / invalid / expired / too_many_attempts)
--                                    instead of raising, so failed attempts are really recorded (an exception would roll the
--                                    record back). 10 failed attempts per person per hour → every attempt is refused for the
--                                    rest of that hour, even with a correct code, so guessing codes is useless.
--   join_trip_by_code(code)          same name and signature as before (older app versions keep working); now follows the
--                                    same checks and throttling and returns null instead of raising when it fails.
--
-- Additive and safe to re-run. Existing links keep working (no expiry) until the owner makes a new one.

alter table public.trips add column if not exists invite_expires_at timestamptz;

create table if not exists public.invite_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists invite_attempts_user_at on public.invite_attempts (user_id, at desc);
alter table public.invite_attempts enable row level security;   -- no policies: nobody reads or writes it from the app
revoke all on public.invite_attempts from anon, authenticated;

create or replace function public.rotate_trip_invite(p_trip uuid, p_expires_in_hours integer default null)
returns table (invite_code text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  v_code text;
  v_exp timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_expires_in_hours is not null and (p_expires_in_hours < 1 or p_expires_in_hours > 24 * 90) then
    raise exception 'Expiry must be between 1 hour and 90 days' using errcode = '22023';
  end if;
  perform 1 from public.trips t where t.id = p_trip and t.owner_id = uid for update;
  if not found then
    raise exception 'Only the trip owner can make a new invite link' using errcode = '42501';
  end if;
  v_exp := case when p_expires_in_hours is null then null else now() + make_interval(hours => p_expires_in_hours) end;
  loop
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    begin
      update public.trips t set invite_code = v_code, invite_expires_at = v_exp where t.id = p_trip;
      exit;
    exception when unique_violation then
      -- astronomically unlikely; just draw another code
    end;
  end loop;
  return query select v_code, v_exp;
end;
$$;
revoke all on function public.rotate_trip_invite(uuid, integer) from public, anon;
grant execute on function public.rotate_trip_invite(uuid, integer) to authenticated;

create or replace function public.join_trip_with_invite(_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_trip uuid;
  v_exp  timestamptz;
  v_name text;
  v_failures int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- One attempt at a time per person, so parallel requests cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtext('invite:' || v_uid::text));
  delete from public.invite_attempts where user_id = v_uid and at < now() - interval '1 day';
  select count(*) into v_failures from public.invite_attempts where user_id = v_uid and at > now() - interval '1 hour';
  if v_failures >= 10 then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;

  select t.id, t.invite_expires_at into v_trip, v_exp from public.trips t where t.invite_code = _code;
  if v_trip is null then
    insert into public.invite_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.trip_members m where m.trip_id = v_trip and m.user_id = v_uid) then
    return jsonb_build_object('status', 'already_member', 'trip_id', v_trip);
  end if;
  if v_exp is not null and v_exp <= now() then
    insert into public.invite_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'expired');
  end if;

  select coalesce(nullif(raw_user_meta_data->>'display_name', ''), nullif(split_part(email, '@', 1), ''), 'Traveler')
    into v_name from auth.users where id = v_uid;
  insert into public.trip_members (trip_id, user_id, display_name, avatar_color)
  values (v_trip, v_uid, coalesce(v_name, 'Traveler'),
          (array['#1C7C6D','#C1542C','#E8A33D','#3B6EA5','#7A5C9E','#4F8A3C'])[1 + floor(random() * 6)::int])
  on conflict (trip_id, user_id) do nothing;
  return jsonb_build_object('status', 'joined', 'trip_id', v_trip);
end;
$$;
revoke all on function public.join_trip_with_invite(text) from public, anon;
grant execute on function public.join_trip_with_invite(text) to authenticated;

-- The old entry point: same name, arguments and return type, now with the same checks and throttling.
create or replace function public.join_trip_by_code(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  r := public.join_trip_with_invite(_code);
  return case when r->>'status' in ('joined', 'already_member') then (r->>'trip_id')::uuid else null end;
end;
$$;
revoke all on function public.join_trip_by_code(text) from public, anon;
grant execute on function public.join_trip_by_code(text) to authenticated;
