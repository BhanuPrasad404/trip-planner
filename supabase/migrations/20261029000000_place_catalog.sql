-- ============================================================================
-- Trailmate's OWN catalogue of places worth a trip, for all of India, filled in the background from free open data (never during a tap):
--   place_catalog    one row per real place (forts, temples, waterfalls, beaches, parks, lakes, museums, viewpoints, heritage, hills),
--                    with WHERE IT CAME FROM and WHEN: OpenStreetMap (Geofabrik extract date) and/or Wikidata (fetch date)
--   catalog_regions  state and union-territory borders (from the same OpenStreetMap extract), for "places in this state"
--   catalog_loads    every load run: source, data date, rows, ok/failed (the health page and the "updated on" labels read it)
-- Filled by scripts/catalog/*.ts (see docs/PLACE_CATALOG.md) with the service role. Read by the server only (service role), like
-- explore_cache: travellers never read or write these tables directly, so nobody can plant a place or a link that others see.
-- Additive only: nothing existing is changed.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.place_catalog (
  -- 'wd:Q123' for anything Wikidata knows (OpenStreetMap elements that link to it merge into the same row), else 'osm:way/123'.
  key        text primary key check (key ~ '^(wd:Q[0-9]{1,12}|osm:(node|way|relation)/[0-9]{1,15})$'),
  name       text not null check (char_length(name) between 2 and 120),
  category   text not null check (category in ('fort','temple','waterfall','beach','wildlife','lake','museum','viewpoint','heritage','peak')),
  lat        double precision not null check (lat between 6 and 38),
  lng        double precision not null check (lng between 68 and 98),
  geog       extensions.geography(Point, 4326)
             generated always as ((extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326))::extensions.geography) stored,
  wikidata   text check (wikidata is null or wikidata ~ '^Q[0-9]{1,12}$'),
  -- English Wikipedia article title only (the app builds the address); never a free-form link.
  wikipedia  text check (wikipedia is null or char_length(wikipedia) between 1 and 150),
  sitelinks  integer not null default 0 check (sitelinks between 0 and 1000),
  heritage   boolean not null default false,
  -- A Wikimedia Commons file name ("File:X.jpg"), or an https image address from OpenStreetMap. The app re-checks both before use.
  commons    text check (commons is null or (commons ~ '^File:' and char_length(commons) <= 205)),
  image      text check (image is null or (image ~ '^https://' and char_length(image) <= 300)),
  hours      text check (hours is null or char_length(hours) <= 120),
  website    text check (website is null or (website ~ '^https?://' and char_length(website) <= 300)),
  osm_id     text check (osm_id is null or osm_id ~ '^(node|way|relation)/[0-9]{1,15}$'),
  -- The state by the nearest place in our offline list (GeoNames). Used ONLY for a state whose border isn't loaded (Arunachal Pradesh's
  -- border runs along the disputed line, partly outside the India extract); a loaded border always decides.
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  -- The state this place is IN, worked out once after each load (catalog_assign_regions): inside a loaded border, else state_code.
  -- "Places in this state" is then an index lookup, not a polygon test at every tap.
  region_code text check (region_code is null or region_code ~ '^[A-Z]{2}$'),
  osm_date   date,                                  -- the OpenStreetMap extract this row was last seen in
  wd_date    date,                                  -- the day Wikidata was last asked about it
  notable    boolean generated always as (wikidata is not null or wikipedia is not null or heritage) stored,
  -- The same order as a live map answer (lib/explore/items.ts), plus how many Wikipedias write about it.
  rank       real generated always as (
               (case when wikidata is not null or wikipedia is not null or heritage then 10 else 0 end)
             + (case when heritage then 1 else 0 end) + (case when wikipedia is not null then 1 else 0 end)
             + (case when commons is not null or image is not null then 1 else 0 end)
             + least(5, ln(1 + sitelinks))::real
             + (case when osm_id like 'relation/%' then 2 when osm_id like 'way/%' then 1 else 0 end)) stored,
  updated_at timestamptz not null default now(),
  check (osm_date is not null or wd_date is not null)
);
create index if not exists place_catalog_geog_gix on public.place_catalog using gist (geog);
create index if not exists place_catalog_cat_rank_idx on public.place_catalog (category, notable, rank desc);
create index if not exists place_catalog_region_idx on public.place_catalog (region_code, category, notable, rank desc);
create index if not exists place_catalog_osm_date_idx on public.place_catalog (osm_date);
create index if not exists place_catalog_wd_date_idx on public.place_catalog (wd_date);

create table if not exists public.catalog_regions (
  code        text primary key check (code ~ '^[A-Z]{2}$'),
  name        text not null check (char_length(name) between 2 and 80),
  geog        extensions.geography(MultiPolygon, 4326) not null,
  source_date date not null,
  updated_at  timestamptz not null default now()
);
create index if not exists catalog_regions_geog_gix on public.catalog_regions using gist (geog);
-- The same borders cut into small pieces (st_subdivide), so "which state is this point in" is a fast index lookup.
create table if not exists public.catalog_region_parts (
  code text not null references public.catalog_regions(code) on delete cascade,
  part extensions.geometry(Polygon, 4326) not null
);
create index if not exists catalog_region_parts_gix on public.catalog_region_parts using gist (part);

create table if not exists public.catalog_loads (
  id          bigint generated always as identity primary key,
  source      text not null check (source in ('wikidata','osm','regions')),
  data_date   date not null,
  rows_loaded integer not null default 0 check (rows_loaded >= 0),
  status      text not null default 'running' check (status in ('running','ok','failed')),
  note        text check (note is null or char_length(note) <= 500),
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists catalog_loads_source_idx on public.catalog_loads (source, status, finished_at desc);

alter table public.place_catalog   enable row level security;
alter table public.catalog_regions enable row level security;
alter table public.catalog_loads   enable row level security;
alter table public.catalog_region_parts enable row level security;
-- No policies: with RLS on, only the service role (which bypasses RLS) can read or write. Take the privileges away too.
revoke all on public.place_catalog, public.catalog_regions, public.catalog_loads, public.catalog_region_parts from anon, authenticated;

-- ── Writing (service role only) ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Merge rows from ONE source. Each source owns its own facts, so loading one never wipes the other's:
--   OpenStreetMap owns the name, kind and position (precise, mapped on the ground), the opening hours and its own id/date;
--   Wikidata owns the sitelinks count and its date, and fills name/kind/position only for places OpenStreetMap doesn't have.
create or replace function public.catalog_merge(_rows jsonb, _source text, _date date)
returns integer language plpgsql set search_path = public, extensions as $$
declare n integer;
begin
  if _source not in ('osm', 'wikidata') then raise exception 'unknown source %', _source; end if;
  if jsonb_typeof(_rows) <> 'array' or jsonb_array_length(_rows) > 5000 then raise exception 'rows must be an array of at most 5000'; end if;
  insert into public.place_catalog as c (key, name, category, lat, lng, wikidata, wikipedia, sitelinks, heritage, commons, image, hours, website, state_code, osm_id, osm_date, wd_date)
  select r.key, r.name, r.category, r.lat, r.lng, r.wikidata, r.wikipedia, coalesce(r.sitelinks, 0), coalesce(r.heritage, false), r.commons, r.image,
         case when _source = 'osm' then r.hours end, r.website, r.state_code,
         case when _source = 'osm' then r.osm_id end, case when _source = 'osm' then _date end, case when _source = 'wikidata' then _date end
  from jsonb_to_recordset(_rows) as r(key text, name text, category text, lat double precision, lng double precision, wikidata text, wikipedia text,
       sitelinks integer, heritage boolean, commons text, image text, hours text, website text, state_code text, osm_id text)
  on conflict (key) do update set
    name      = case when _source = 'osm' or c.osm_date is null then excluded.name else c.name end,
    category  = case when _source = 'osm' or c.osm_date is null then excluded.category else c.category end,
    lat       = case when _source = 'osm' or c.osm_date is null then excluded.lat else c.lat end,
    lng       = case when _source = 'osm' or c.osm_date is null then excluded.lng else c.lng end,
    wikidata  = coalesce(excluded.wikidata, c.wikidata),
    wikipedia = coalesce(excluded.wikipedia, c.wikipedia),
    sitelinks = case when _source = 'wikidata' then excluded.sitelinks else c.sitelinks end,
    heritage  = excluded.heritage or c.heritage,
    commons   = coalesce(excluded.commons, c.commons),
    image     = coalesce(excluded.image, c.image),
    hours     = case when _source = 'osm' then excluded.hours else c.hours end,
    website   = coalesce(excluded.website, c.website),
    state_code = case when _source = 'osm' or c.osm_date is null then coalesce(excluded.state_code, c.state_code) else c.state_code end,
    osm_id    = case when _source = 'osm' then excluded.osm_id else c.osm_id end,
    osm_date  = case when _source = 'osm' then excluded.osm_date else c.osm_date end,
    wd_date   = case when _source = 'wikidata' then excluded.wd_date else c.wd_date end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- After a COMPLETE load of a source dated _date: whatever that source no longer has is taken off. A row the other source still has
-- keeps living with that source's facts only; a row neither source has any more is removed.
create or replace function public.catalog_prune(_source text, _date date)
returns integer language plpgsql set search_path = public, extensions as $$
declare n integer := 0; m integer;
begin
  if _source = 'osm' then
    delete from public.place_catalog where osm_date < _date and wd_date is null;
    get diagnostics n = row_count;
    update public.place_catalog set osm_id = null, osm_date = null, hours = null where osm_date < _date;
    get diagnostics m = row_count;
  elsif _source = 'wikidata' then
    delete from public.place_catalog where wd_date < _date and osm_date is null;
    get diagnostics n = row_count;
    update public.place_catalog set wd_date = null, sitelinks = 0 where wd_date < _date;
    get diagnostics m = row_count;
  else
    raise exception 'unknown source %', _source;
  end if;
  return n + m;
end $$;

create or replace function public.catalog_set_region(_code text, _name text, _geojson jsonb, _date date)
returns void language plpgsql set search_path = public, extensions as $$
begin
  insert into public.catalog_regions (code, name, geog, source_date)
  values (_code, _name, st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson(_geojson::text), 4326)), 3))::geography, _date)
  on conflict (code) do update set name = excluded.name, geog = excluded.geog, source_date = excluded.source_date, updated_at = now();
  delete from public.catalog_region_parts where code = _code;
  insert into public.catalog_region_parts (code, part)
  select _code, (st_dump(st_subdivide(r.geog::geometry, 256))).geom from public.catalog_regions r where r.code = _code;
end $$;

-- After every load: each place's state, by the borders (a point inside one), else by its state code (a coastal place just outside a
-- simplified border, or a state with no border loaded). Works in pages (by key) so no single call runs long: call with the key it
-- returned until it returns null.
create or replace function public.catalog_assign_regions(_after text default '', _limit integer default 10000)
returns text language plpgsql set search_path = public, extensions as $$
declare last_key text;
begin
  with page as (
    select c.key, c.lat, c.lng, c.state_code, c.region_code from public.place_catalog c
    where c.key > coalesce(_after, '') order by c.key limit least(greatest(_limit, 1), 50000)
  ), hit as (
    select g.key, g.region_code as old, coalesce(
      (select p.code from public.catalog_region_parts p where st_intersects(p.part, st_setsrid(st_makepoint(g.lng, g.lat), 4326)) limit 1),
      g.state_code) as code
    from page g
  ), done as (
    update public.place_catalog c set region_code = h.code from hit h where c.key = h.key and h.old is distinct from h.code returning c.key
  )
  select max(key) into last_key from page;
  return last_key;
end $$;

-- ── Reading (service role only; the server calls these) ──────────────────────────────────────────────────────────────────────────
-- Like a live map answer: up to _notable_limit places somebody found notable, then up to _other_limit others, best first. Categories in
-- _need_notable return notable places only (every shrine and pond in a state is not a recommendation). One function per scope, so each
-- uses the spatial index directly.
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typname = 'catalog_place' and n.nspname = 'public') then
    create type public.catalog_place as (key text, name text, category text, lat double precision, lng double precision, notable boolean, heritage boolean,
      wikidata text, wikipedia text, sitelinks integer, commons text, image text, hours text, website text, osm_id text, osm_date date, wd_date date, rank real);
  end if;
end $$;

-- Places within _radius_m (at most 100 km) of a point.
create or replace function public.catalog_near(_lat double precision, _lng double precision, _radius_m integer, _cats text[], _need_notable text[], _notable_limit integer default 300, _other_limit integer default 150)
returns setof public.catalog_place language sql stable set search_path = public, extensions as $$
  with scope as (
    select c.* from public.place_catalog c
    where st_dwithin(c.geog, st_setsrid(st_makepoint(_lng, _lat), 4326)::geography, least(greatest(_radius_m, 100), 100000))
      and c.category = any(_cats)
      and (c.notable or not (c.category = any(coalesce(_need_notable, '{}'))))
  )
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank from scope s where s.notable order by s.rank desc, s.key limit least(greatest(_notable_limit, 0), 1000))
  union all
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank from scope s where not s.notable order by s.rank desc, s.key limit least(greatest(_other_limit, 0), 1000));
$$;

-- Places within _buffer_m (at most 50 km) of a road line (GeoJSON LineString).
create or replace function public.catalog_along(_line jsonb, _buffer_m integer, _cats text[], _need_notable text[], _notable_limit integer default 300, _other_limit integer default 150)
returns setof public.catalog_place language sql stable set search_path = public, extensions as $$
  with scope as (
    select c.* from public.place_catalog c
    where st_dwithin(c.geog, st_setsrid(st_geomfromgeojson(_line::text), 4326)::geography, least(greatest(_buffer_m, 100), 50000))
      and c.category = any(_cats)
      and (c.notable or not (c.category = any(coalesce(_need_notable, '{}'))))
  )
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank from scope s where s.notable order by s.rank desc, s.key limit least(greatest(_notable_limit, 0), 1000))
  union all
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank from scope s where not s.notable order by s.rank desc, s.key limit least(greatest(_other_limit, 0), 1000));
$$;

-- Places in a state or union territory (region_code, worked out after each load by catalog_assign_regions).
create or replace function public.catalog_in_region(_code text, _cats text[], _need_notable text[], _notable_limit integer default 300, _other_limit integer default 150)
returns setof public.catalog_place language sql stable set search_path = public, extensions as $$
  with scope as (
    select c.* from public.place_catalog c
    where c.region_code = _code
      and c.category = any(_cats)
      and (c.notable or not (c.category = any(coalesce(_need_notable, '{}'))))
  )
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank from scope s where s.notable order by s.rank desc, s.key limit least(greatest(_notable_limit, 0), 1000))
  union all
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank from scope s where not s.notable order by s.rank desc, s.key limit least(greatest(_other_limit, 0), 1000));
$$;

-- What is loaded, from which data date, how many rows: for "is the catalogue ready?" and the health page.
create or replace function public.catalog_status()
returns table (source text, data_date date, rows_loaded integer, finished_at timestamptz, places bigint, regions bigint)
language sql stable set search_path = public as $$
  select s.source, l.data_date, l.rows_loaded, l.finished_at,
         (select count(*) from public.place_catalog), (select count(*) from public.catalog_regions)
  from (values ('osm'), ('wikidata'), ('regions')) as s(source)
  left join lateral (select * from public.catalog_loads cl where cl.source = s.source and cl.status = 'ok' order by cl.finished_at desc limit 1) l on true;
$$;

revoke all on function public.catalog_merge(jsonb, text, date), public.catalog_prune(text, date), public.catalog_set_region(text, text, jsonb, date), public.catalog_assign_regions(text, integer),
  public.catalog_near(double precision, double precision, integer, text[], text[], integer, integer),
  public.catalog_along(jsonb, integer, text[], text[], integer, integer),
  public.catalog_in_region(text, text[], text[], integer, integer), public.catalog_status() from public, anon, authenticated;
grant execute on function public.catalog_merge(jsonb, text, date), public.catalog_prune(text, date), public.catalog_set_region(text, text, jsonb, date), public.catalog_assign_regions(text, integer),
  public.catalog_near(double precision, double precision, integer, text[], text[], integer, integer),
  public.catalog_along(jsonb, integer, text[], text[], integer, integer),
  public.catalog_in_region(text, text[], text[], integer, integer), public.catalog_status() to service_role;
