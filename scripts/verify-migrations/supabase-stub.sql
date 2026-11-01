-- The smallest imitation of Supabase that the three journey-intelligence migrations need, so they can be run on PGlite (Postgres compiled to
-- WebAssembly) with no database server. It is NOT Supabase: see docs/MIGRATION_VERIFICATION.md for what this does and does not prove.
-- Shapes follow the real ones (supabase/migrations/20260804000000_init_schema.sql, 20261006000000_security_hardening_and_invites.sql,
-- supabase/tests/bootstrap.sql), reduced to the columns these migrations and their tests touch.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  name text not null,
  num_days int not null default 1,
  invite_code text
);
create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text,
  unique (trip_id, user_id)
);
create table public.places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  day_number int,
  status text not null default 'planned',
  status_at timestamptz,
  constraint places_status_valid check (status in ('planned', 'done', 'skipped'))
);

-- The two membership helpers the policies use (same logic as the real ones).
create function public.is_trip_member(_trip_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.trip_members where trip_id = _trip_id and user_id = auth.uid())
$$;
create function public.is_trip_owner(_trip_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.trips where id = _trip_id and owner_id = auth.uid())
$$;

-- What Supabase grants by default: every public table is reachable by the API roles, and Row Level Security is what protects it.
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
