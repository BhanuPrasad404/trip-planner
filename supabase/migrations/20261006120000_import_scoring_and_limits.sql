-- ============================================================================
-- TRAILMATE — Migration 3: smart import, go score, real routing, AI quota
-- Run AFTER 20261006000000_security_hardening_and_invites.sql
-- ============================================================================

-- ─── 1. Places: category (drives Go Score), and real driving legs ───────────
alter table public.places
  add column if not exists category      text,
  add column if not exists drive_minutes int,
  add column if not exists drive_km      numeric(7,1);

alter table public.places
  add constraint places_category_length check (category is null or char_length(category) <= 40),
  add constraint places_drive_minutes_nonneg check (drive_minutes is null or drive_minutes >= 0),
  add constraint places_drive_km_nonneg check (drive_km is null or drive_km >= 0);

-- ─── 2. Usage metering for paid AI calls (per-user daily limits) ────────────
create table if not exists public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (char_length(kind) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_events_user_kind_time
  on public.usage_events (user_id, kind, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "Users can view own usage" on public.usage_events;
create policy "Users can view own usage" on public.usage_events
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: events can only be written by consume_quota() below,
-- so users can neither fake nor erase their own usage.

-- Atomically: "if this user is under the limit, record one use and return true; else return false".
create or replace function public.consume_quota(
  _kind   text,
  _limit  int,
  _window interval default interval '24 hours'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if _kind is null or char_length(_kind) > 40 or _limit < 1 or _limit > 100000 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- Serialise concurrent requests from the same user so parallel calls can't overshoot the limit.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || _kind, 0));

  select count(*) into v_count
    from public.usage_events
   where user_id = v_uid and kind = _kind and created_at > now() - _window;

  if v_count >= _limit then
    return false;
  end if;

  insert into public.usage_events (user_id, kind) values (v_uid, _kind);
  return true;
end;
$$;

revoke all on function public.consume_quota(text, int, interval) from public, anon;
grant execute on function public.consume_quota(text, int, interval) to authenticated;
