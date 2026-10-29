-- ============================================================================
-- The map's hours facts beside its opening_hours, so one shared resolver (lib/server/hours-resolver.ts) can say what is known about a
-- place's hours, from where, and as of when:
--   service_times  darshan / prayer / service times as mapped (OpenStreetMap `service_times`), written exactly as the map has it
--   hours_url      the page the hours come from (`opening_hours:url`): shown as a link, never read by us
--   check_date     the day a mapper last checked the hours (`check_date:opening_hours`, else `check_date`)
-- All three belong to OpenStreetMap: a Wikidata load never touches them, a map prune takes them away with the map's other facts.
-- Additive only: three nullable columns, the two writers re-created with the same arguments, the reader's row type extended.
-- ============================================================================

alter table public.place_catalog
  add column if not exists service_times text check (service_times is null or char_length(service_times) between 1 and 120),
  add column if not exists hours_url text check (hours_url is null or (hours_url ~ '^https?://' and char_length(hours_url) <= 300)),
  add column if not exists check_date date;

create or replace function public.catalog_merge(_rows jsonb, _source text, _date date)
returns integer language plpgsql set search_path = public, extensions as $$
declare n integer;
begin
  if _source not in ('osm', 'wikidata') then raise exception 'unknown source %', _source; end if;
  if jsonb_typeof(_rows) <> 'array' or jsonb_array_length(_rows) > 5000 then raise exception 'rows must be an array of at most 5000'; end if;
  insert into public.place_catalog as c (key, name, category, lat, lng, wikidata, wikipedia, sitelinks, heritage, commons, image, hours, website, state_code, osm_id, osm_date, wd_date,
                                         wd_type, osm_type, located_in, located_in_name, part_of, service_times, hours_url, check_date)
  select r.key, r.name, r.category, r.lat, r.lng, r.wikidata, r.wikipedia, coalesce(r.sitelinks, 0), coalesce(r.heritage, false), r.commons, r.image,
         case when _source = 'osm' then r.hours end, r.website, r.state_code,
         case when _source = 'osm' then r.osm_id end, case when _source = 'osm' then _date end, case when _source = 'wikidata' then _date end,
         case when _source = 'wikidata' then r.wd_type end, case when _source = 'osm' then r.osm_type end,
         case when _source = 'wikidata' then r.located_in end, case when _source = 'wikidata' then r.located_in_name end, case when _source = 'wikidata' then r.part_of end,
         case when _source = 'osm' then r.service_times end, case when _source = 'osm' then r.hours_url end, case when _source = 'osm' then r.check_date end
  from jsonb_to_recordset(_rows) as r(key text, name text, category text, lat double precision, lng double precision, wikidata text, wikipedia text,
       sitelinks integer, heritage boolean, commons text, image text, hours text, website text, state_code text, osm_id text,
       wd_type text, osm_type text, located_in text, located_in_name text, part_of text, service_times text, hours_url text, check_date date)
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
    wd_type   = case when _source = 'wikidata' then excluded.wd_type else c.wd_type end,
    osm_type  = case when _source = 'osm' then excluded.osm_type else c.osm_type end,
    located_in      = case when _source = 'wikidata' then excluded.located_in else c.located_in end,
    located_in_name = case when _source = 'wikidata' then excluded.located_in_name else c.located_in_name end,
    part_of   = case when _source = 'wikidata' then excluded.part_of else c.part_of end,
    service_times = case when _source = 'osm' then excluded.service_times else c.service_times end,
    hours_url  = case when _source = 'osm' then excluded.hours_url else c.hours_url end,
    check_date = case when _source = 'osm' then excluded.check_date else c.check_date end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.catalog_prune(_source text, _date date)
returns integer language plpgsql set search_path = public, extensions as $$
declare n integer := 0; m integer;
begin
  if _source = 'osm' then
    delete from public.place_catalog where osm_date < _date and wd_date is null;
    get diagnostics n = row_count;
    update public.place_catalog set osm_id = null, osm_date = null, hours = null, osm_type = null, service_times = null, hours_url = null, check_date = null where osm_date < _date;
    get diagnostics m = row_count;
  elsif _source = 'wikidata' then
    delete from public.place_catalog where wd_date < _date and osm_date is null;
    get diagnostics n = row_count;
    update public.place_catalog set wd_date = null, sitelinks = 0, wd_type = null, located_in = null, located_in_name = null, part_of = null where wd_date < _date;
    get diagnostics m = row_count;
  else
    raise exception 'unknown source %', _source;
  end if;
  return n + m;
end $$;

-- The reader returns the three new facts too (attributes added at the end, so older callers that read by name are unaffected).
do $$ begin
  if not exists (select 1 from information_schema.attributes where udt_schema = 'public' and udt_name = 'catalog_site' and attribute_name = 'service_times') then
    alter type public.catalog_site add attribute service_times text, add attribute hours_url text, add attribute check_date date;
  end if;
end $$;

create or replace function public.catalog_sites(_lat double precision, _lng double precision, _radius_m integer, _region text, _notable_limit integer default 200, _other_limit integer default 50)
returns setof public.catalog_site language sql stable set search_path = public, extensions as $$
  with scope as (
    select c.* from public.place_catalog c
    where case when _lat is not null and _lng is not null
               then st_dwithin(c.geog, st_setsrid(st_makepoint(_lng, _lat), 4326)::geography, least(greatest(coalesce(_radius_m, 0), 100), 100000))
               else _region is not null and c.region_code = _region end
  )
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank,
          s.region_code, s.wd_type, s.osm_type, s.located_in, s.located_in_name, s.part_of, s.service_times, s.hours_url, s.check_date
   from scope s where s.notable order by s.rank desc, s.key limit least(greatest(_notable_limit, 0), 1000))
  union all
  (select s.key, s.name, s.category, s.lat, s.lng, s.notable, s.heritage, s.wikidata, s.wikipedia, s.sitelinks, s.commons, s.image, s.hours, s.website, s.osm_id, s.osm_date, s.wd_date, s.rank,
          s.region_code, s.wd_type, s.osm_type, s.located_in, s.located_in_name, s.part_of, s.service_times, s.hours_url, s.check_date
   from scope s where not s.notable order by s.rank desc, s.key limit least(greatest(_other_limit, 0), 1000));
$$;

revoke all on function public.catalog_sites(double precision, double precision, integer, text, integer, integer) from public, anon, authenticated;
grant execute on function public.catalog_sites(double precision, double precision, integer, text, integer, integer) to service_role;
revoke all on function public.catalog_merge(jsonb, text, date), public.catalog_prune(text, date) from public, anon, authenticated;
grant execute on function public.catalog_merge(jsonb, text, date), public.catalog_prune(text, date) to service_role;
