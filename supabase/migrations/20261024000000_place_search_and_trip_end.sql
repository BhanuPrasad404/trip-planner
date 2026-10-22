-- Trip creation, phase 1: how a trip ends, and daily limits for signed-out place search.
--
--   trips.end_mode                       'start' (return to start) | 'place' (end at dest_name/dest_lat/dest_lng) | 'open' (no fixed end).
--                                        NULL = a trip created before this change: it keeps behaving exactly as before.
--   visitor_usage                        one row per outside call a GUEST made (map search, "search more", naming a position). The
--                                        visitor key is an HMAC of a random cookie or of the network address: never the raw value.
--                                        Nobody can read or write it except through consume_visitor_quota (service role only).
--   consume_visitor_quota(...)           "if this guest is under the limit, record one use and return true; else false" — the guest
--                                        twin of consume_quota().
--
-- ADDITIVE ONLY: one new column, one new table, one new function. Nothing existing is renamed, changed or dropped, so the app version
-- already running against this database keeps working. Safe to re-run.

-- 1. How the trip ends ------------------------------------------------------------------------------------------------------------
alter table public.trips add column if not exists end_mode text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trips_end_mode_valid' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_end_mode_valid check (end_mode is null or end_mode in ('start', 'place', 'open'));
  end if;
  -- "End at a place" needs that place.
  if not exists (select 1 from pg_constraint where conname = 'trips_end_place_has_point' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_end_place_has_point check (end_mode is distinct from 'place' or (dest_lat is not null and dest_lng is not null));
  end if;
end $$;

comment on column public.trips.end_mode is 'start = return to start · place = end at dest_* · open = no fixed end · null = created before end_mode existed (old behaviour)';

-- 2. Guest daily limits ----------------------------------------------------------------------------------------------------------
create table if not exists public.visitor_usage (
  id          bigint generated always as identity primary key,
  visitor_key text not null check (char_length(visitor_key) between 16 and 64),
  kind        text not null check (char_length(kind) between 1 and 40),
  created_at  timestamptz not null default now()
);
create index if not exists visitor_usage_key_kind_time on public.visitor_usage (visitor_key, kind, created_at desc);
create index if not exists visitor_usage_created on public.visitor_usage (created_at);

alter table public.visitor_usage enable row level security;   -- no policies: never readable or writable from the app's clients
revoke all on public.visitor_usage from anon, authenticated;

create or replace function public.consume_visitor_quota(
  _visitor text,
  _kind    text,
  _limit   int,
  _window  interval default interval '24 hours'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if _visitor is null or char_length(_visitor) < 16 or char_length(_visitor) > 64
     or _kind is null or char_length(_kind) < 1 or char_length(_kind) > 40
     or _limit is null or _limit < 1 or _limit > 100000
     or _window is null or _window > interval '7 days' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- Serialise concurrent calls for the same visitor and kind so parallel requests can't overshoot the limit.
  perform pg_advisory_xact_lock(hashtextextended(_visitor || ':' || _kind, 0));

  -- Housekeeping, not schema change: usage rows older than 2 days are never needed again (the window is at most 24 h by default).
  -- This visitor's old rows every time; everyone's old rows now and then, so the table stays small without a scheduled job.
  delete from public.visitor_usage where visitor_key = _visitor and created_at < now() - interval '2 days';
  if random() < 0.01 then
    delete from public.visitor_usage where created_at < now() - interval '2 days';
  end if;

  select count(*) into v_count
    from public.visitor_usage
   where visitor_key = _visitor and kind = _kind and created_at > now() - _window;
  if v_count >= _limit then
    return false;
  end if;

  insert into public.visitor_usage (visitor_key, kind) values (_visitor, _kind);
  return true;
end $$;

revoke all on function public.consume_visitor_quota(text, text, int, interval) from public, anon, authenticated;
grant execute on function public.consume_visitor_quota(text, text, int, interval) to service_role;
