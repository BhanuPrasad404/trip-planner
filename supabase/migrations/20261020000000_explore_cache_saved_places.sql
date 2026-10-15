-- Explore: a shared cache of discovered places, and places a traveller saved.
--
-- Additive and optional: two new tables nothing else references. The app works without them (the cache falls back to memory; saving
-- needs the second table), so this migration can be applied at any time, in any order relative to the others.
--
-- explore_cache
--   key         'state:TG:fort' = one ranked list per region and category (built by lib/explore/service.ts), the same for everyone
--   payload     the list as JSON (at most ~460 places). The app re-validates every item it reads back.
--   algo        version of the parsing/ranking rules that produced it; rows with an older version are ignored
--   expires_at  after this the row is dropped from use; a list older than 3 days is refreshed, but still served if the map servers are down
--   Security: public map facts only. Nobody signed in can read or write (the server's service role does both), so a traveller can never
--   put an arbitrary place or link in the list every other traveller sees.
--
-- saved_places
--   A place a traveller saved from Explore, private to them, no trip required. place_key is the place's identity (an OpenStreetMap
--   element like 'way/123', or 'season:<id>'), so saving twice is one row. At most 500 per person (enforced by a trigger).

create table if not exists public.explore_cache (
  key        text primary key check (char_length(key) between 3 and 80),
  payload    jsonb not null check (jsonb_typeof(payload) = 'array' and pg_column_size(payload) <= 600000),
  item_count integer not null check (item_count between 0 and 500),
  algo       integer not null default 1 check (algo >= 1),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists explore_cache_expires_idx on public.explore_cache (expires_at);
alter table public.explore_cache enable row level security;
-- No policy at all: with RLS on, nobody but the service role (which bypasses RLS) can read or write. Take the privileges away too.
revoke all on public.explore_cache from anon, authenticated;

create table if not exists public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  place_key  text not null check (place_key ~* '^[a-z0-9:_/.-]{3,80}$'),
  name       text not null check (char_length(name) between 1 and 120),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  category   text check (category is null or char_length(category) <= 40),
  region     text check (region is null or char_length(region) <= 80),
  created_at timestamptz not null default now(),
  unique (user_id, place_key)
);
create index if not exists saved_places_user_idx on public.saved_places (user_id, created_at desc);
alter table public.saved_places enable row level security;

drop policy if exists "Read own saved places" on public.saved_places;
create policy "Read own saved places" on public.saved_places for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Save places as myself" on public.saved_places;
create policy "Save places as myself" on public.saved_places for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Remove own saved places" on public.saved_places;
create policy "Remove own saved places" on public.saved_places for delete to authenticated using (auth.uid() = user_id);
-- No update policy: a saved place is saved or removed, never edited.
revoke all on public.saved_places from anon;
revoke update, truncate on public.saved_places from authenticated;

create or replace function public.enforce_saved_places_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.saved_places where user_id = new.user_id) >= 500 then
    raise exception 'You can save up to 500 saved places' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists saved_places_limit on public.saved_places;
create trigger saved_places_limit before insert on public.saved_places for each row execute function public.enforce_saved_places_limit();
