-- ============================================================================
-- Travel intelligence: a post becomes a TRAVEL EXPERIENCE, not just media.
--
--  * Structured experience on every post (all optional): how crowded, conditions, what was special, one tip.
--  * "Posted from the area": a badge a post can only earn by presenting a location near its destination right after posting.
--  * Helpful + Trip Adds: two signals that mean "this helped someone plan", counted per DISTINCT person, feeding ranking and the
--    creator's "your post helped N travelers".
--  * destination_pulse(): the raw material for "what is it like right now" — recent activity, crowd and condition reports,
--    tips — returned as facts with timestamps; the application decides how much to claim from how little (never from one post).
--  * my_contribution() / post_impact(): the creator's impact, computed from OTHER people's actions only.
-- ============================================================================

-- ─── 1. Experience on posts ──────────────────────────────────────────────────
alter table public.posts add column if not exists crowd text;
alter table public.posts add column if not exists conditions text[] not null default '{}';
alter table public.posts add column if not exists vibes text[] not null default '{}';
alter table public.posts add column if not exists tip text;
alter table public.posts add column if not exists verified_area boolean not null default false;

do $$ begin alter table public.posts add constraint posts_crowd_chk check (crowd is null or crowd in ('quiet', 'moderate', 'crowded'));
exception when duplicate_object then null; end $$;
do $$ begin alter table public.posts add constraint posts_conditions_chk check (cardinality(conditions) <= 6 and conditions <@ array['rainy', 'sunny', 'foggy', 'muddy', 'road_good', 'road_bad', 'construction', 'closed', 'long_queue', 'parking_full']::text[]);
exception when duplicate_object then null; end $$;
do $$ begin alter table public.posts add constraint posts_vibes_chk check (cardinality(vibes) <= 5 and vibes <@ array['best_view', 'hidden_gem', 'food', 'adventure', 'photography', 'peaceful', 'family', 'budget', 'romantic', 'sunrise', 'sunset']::text[]);
exception when duplicate_object then null; end $$;
do $$ begin alter table public.posts add constraint posts_tip_chk check (tip is null or char_length(tip) between 3 and 160);
exception when duplicate_object then null; end $$;

-- verified_area can only be earned through verify_post_area() below (a transaction-local flag lets that one function through).
create or replace function public.posts_before_write()
returns trigger language plpgsql as $$
begin
  if new.location_precision = 'approx' then       -- ≈1 km: enough for "RK Beach", not "which bench"
    new.lat := round(new.lat::numeric, 2);
    new.lng := round(new.lng::numeric, 2);
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.status := 'visible';
    new.moderation := 'approved';                  -- the hook: switch to 'pending' when automated moderation exists
    new.verified_area := false;
  else                                             -- people edit their words, never who/when/where/moderation state
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    if (select auth.uid()) is not null then
      new.status := old.status;
      new.moderation := old.moderation;
      new.destination_id := old.destination_id;
      if coalesce(current_setting('trailmate.verifying', true), '') <> '1' then new.verified_area := old.verified_area; end if;
    end if;
  end if;
  new.captured_at := least(coalesce(new.captured_at, now()), now());   -- never in the future
  return new;
end $$;

-- "Posted from the area": the author presents the device's position within minutes of posting; it must be near the destination.
-- This cannot PROVE presence (a phone's location can be faked), so the app words it as "posted from the area", not "verified".
create or replace function public.verify_post_area(_post uuid, _lat double precision, _lng double precision)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if _lat is null or _lng is null or _lat not between -90 and 90 or _lng not between -180 and 180 then return false; end if;
  select exists (
    select 1 from public.posts p join public.destinations d on d.id = p.destination_id
     where p.id = _post and p.author_id = (select auth.uid()) and p.created_at > now() - interval '15 minutes'
       and extensions.st_dwithin(d.geog, (extensions.st_setsrid(extensions.st_makepoint(_lng, _lat), 4326))::extensions.geography, 20000)
  ) into v_ok;
  if v_ok then
    perform set_config('trailmate.verifying', '1', true);
    update public.posts set verified_area = true where id = _post;
    perform set_config('trailmate.verifying', '', true);
  end if;
  return v_ok;
end $$;
revoke all on function public.verify_post_area(uuid, double precision, double precision) from public, anon;
grant execute on function public.verify_post_area(uuid, double precision, double precision) to authenticated;

-- ─── 2. Helpful + Trip Adds ──────────────────────────────────────────────────
create table if not exists public.post_helpful (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_helpful_user_idx on public.post_helpful (user_id, created_at desc);
alter table public.post_helpful enable row level security;
revoke all on public.post_helpful from anon;
drop policy if exists "My helpful marks" on public.post_helpful;
create policy "My helpful marks" on public.post_helpful for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Mark helpful as myself" on public.post_helpful;
create policy "Mark helpful as myself" on public.post_helpful for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view_post(post_id)
              and not exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));   -- you cannot vouch for your own post
drop policy if exists "Unmark helpful" on public.post_helpful;
create policy "Unmark helpful" on public.post_helpful for delete to authenticated using (user_id = (select auth.uid()));

-- One row per person per post: "N travelers added this to a trip" counts PEOPLE, never how many trips one person made.
create table if not exists public.post_trip_adds (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_trip_adds enable row level security;
revoke all on public.post_trip_adds from anon;
drop policy if exists "My trip adds" on public.post_trip_adds;
create policy "My trip adds" on public.post_trip_adds for select to authenticated using (user_id = (select auth.uid()));
-- No insert policy: record_trip_add() is the only way in, and it checks the trip is really yours.

alter table public.post_counters add column if not exists helpful integer not null default 0;
alter table public.post_counters add column if not exists trip_adds integer not null default 0;
do $$ begin alter table public.post_counters add constraint post_counters_helpful_chk check (helpful >= 0); exception when duplicate_object then null; end $$;
do $$ begin alter table public.post_counters add constraint post_counters_trip_adds_chk check (trip_adds >= 0); exception when duplicate_object then null; end $$;

create or replace function public.bump_post_counter()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d integer := case tg_op when 'INSERT' then 1 else -1 end;
  pid uuid := case tg_op when 'INSERT' then new.post_id else old.post_id end;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.posts where id = pid) then return null; end if;   -- the post is being deleted too
  if tg_table_name = 'post_likes' then
    update public.post_counters set likes = greatest(likes + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_saves' then
    update public.post_counters set saves = greatest(saves + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_comments' then
    update public.post_counters set comments = greatest(comments + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_helpful' then
    update public.post_counters set helpful = greatest(helpful + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_trip_adds' then
    update public.post_counters set trip_adds = greatest(trip_adds + d, 0), updated_at = now() where post_id = pid;
  end if;
  return null;
end $$;
drop trigger if exists bump_helpful_counter_trg on public.post_helpful;
create trigger bump_helpful_counter_trg after insert or delete on public.post_helpful for each row execute function public.bump_post_counter();
drop trigger if exists bump_trip_add_counter_trg on public.post_trip_adds;
create trigger bump_trip_add_counter_trg after insert or delete on public.post_trip_adds for each row execute function public.bump_post_counter();

-- Like / save / helpful: idempotent and race-safe (see destination_feed migration). `helpful` on your own post quietly does nothing.
drop function if exists public.set_post_reaction(uuid, text, boolean);
create function public.set_post_reaction(_post uuid, _kind text, _on boolean)
returns table (changed boolean, likes integer, saves integer, helpful integer)
language plpgsql set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rows integer := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if _kind not in ('like', 'save', 'helpful') then raise exception 'unknown reaction' using errcode = '22023'; end if;
  if _kind = 'helpful' and exists (select 1 from public.posts p where p.id = _post and p.author_id = v_uid) then
    return query select false, c.likes, c.saves, c.helpful from public.post_counters c where c.post_id = _post;
    return;
  end if;
  if _on then
    if _kind = 'like' then insert into public.post_likes (post_id, user_id) values (_post, v_uid) on conflict do nothing;
    elsif _kind = 'save' then insert into public.post_saves (post_id, user_id) values (_post, v_uid) on conflict do nothing;
    else insert into public.post_helpful (post_id, user_id) values (_post, v_uid) on conflict do nothing; end if;
  else
    if _kind = 'like' then delete from public.post_likes where post_id = _post and user_id = v_uid;
    elsif _kind = 'save' then delete from public.post_saves where post_id = _post and user_id = v_uid;
    else delete from public.post_helpful where post_id = _post and user_id = v_uid; end if;
  end if;
  get diagnostics v_rows = row_count;
  return query select v_rows > 0, c.likes, c.saves, c.helpful from public.post_counters c where c.post_id = _post;
end $$;
revoke all on function public.set_post_reaction(uuid, text, boolean) from public, anon;
grant execute on function public.set_post_reaction(uuid, text, boolean) to authenticated;

-- The trip must really be yours, the post must be one you can see, and your own post does not count.
create or replace function public.record_trip_add(_post uuid, _trip uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_trip_member(_trip) or not public.can_view_post(_post) then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.posts p where p.id = _post and p.author_id = v_uid) then return false; end if;
  insert into public.post_trip_adds (post_id, user_id, trip_id) values (_post, v_uid, _trip)
  on conflict (post_id, user_id) do update set trip_id = excluded.trip_id;
  return true;
end $$;
revoke all on function public.record_trip_add(uuid, uuid) from public, anon;
grant execute on function public.record_trip_add(uuid, uuid) to authenticated;

-- ─── 3. Notifications for the new signals ────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('like', 'comment', 'reply', 'helpful', 'trip_add'));
create unique index if not exists notifications_one_helpful_uq on public.notifications (user_id, actor_user, post_id) where kind = 'helpful';
create unique index if not exists notifications_one_trip_add_uq on public.notifications (user_id, actor_user, post_id) where kind = 'trip_add';

create or replace function public.notify_on_signal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_kind text := case tg_table_name when 'post_helpful' then 'helpful' else 'trip_add' end;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.user_id or public.notify_blocked(v_author, new.user_id) then return null; end if;
  insert into public.notifications (user_id, actor_user, kind, post_id) values (v_author, new.user_id, v_kind, new.post_id) on conflict do nothing;
  return null;
end $$;
drop trigger if exists notify_on_helpful_trg on public.post_helpful;
create trigger notify_on_helpful_trg after insert on public.post_helpful for each row execute function public.notify_on_signal();
drop trigger if exists notify_on_trip_add_trg on public.post_trip_adds;
create trigger notify_on_trip_add_trg after insert on public.post_trip_adds for each row execute function public.notify_on_signal();

-- ─── 4. Creator impact: other people's actions only ──────────────────────────
create or replace function public.post_impact(_post uuid)
returns table (travelers integer, saves integer, helpful integer, trip_adds integer, likes integer)
language sql stable security definer set search_path = public as $$
  select (select count(*) from (
            select user_id from public.post_saves where post_id = _post union select user_id from public.post_helpful where post_id = _post union select user_id from public.post_trip_adds where post_id = _post
          ) x where x.user_id <> (select auth.uid()))::integer,
         c.saves, c.helpful, c.trip_adds, c.likes
    from public.post_counters c join public.posts p on p.id = c.post_id
   where c.post_id = _post and p.author_id = (select auth.uid())
$$;
revoke all on function public.post_impact(uuid) from public, anon;
grant execute on function public.post_impact(uuid) to authenticated;

create or replace function public.my_contribution()
returns table (posts integer, destinations integer, travelers_helped integer, saves integer, helpful integer, trip_adds integer, likes integer)
language sql stable security definer set search_path = public as $$
  with mine as (select id, destination_id from public.posts where author_id = (select auth.uid()) and status = 'visible')
  select (select count(*) from mine)::integer,
         (select count(distinct destination_id) from mine)::integer,
         (select count(*) from (
            select user_id from public.post_saves where post_id in (select id from mine)
            union select user_id from public.post_helpful where post_id in (select id from mine)
            union select user_id from public.post_trip_adds where post_id in (select id from mine)
          ) x where x.user_id <> (select auth.uid()))::integer,
         coalesce((select sum(c.saves) from public.post_counters c where c.post_id in (select id from mine)), 0)::integer,
         coalesce((select sum(c.helpful) from public.post_counters c where c.post_id in (select id from mine)), 0)::integer,
         coalesce((select sum(c.trip_adds) from public.post_counters c where c.post_id in (select id from mine)), 0)::integer,
         coalesce((select sum(c.likes) from public.post_counters c where c.post_id in (select id from mine)), 0)::integer
$$;
revoke all on function public.my_contribution() from public, anon;
grant execute on function public.my_contribution() to authenticated;

-- ─── 5. Destination pulse: facts with timestamps, no conclusions ─────────────
-- Runs as the caller (so privacy, blocks and moderation apply). It returns RAW recent reports; the application turns them into
-- "3 of 4 travelers say crowded" only when there are enough of them, and lets each kind of report expire on its own clock.
create or replace function public.destination_pulse(_dest uuid)
returns jsonb language sql stable set search_path = public as $$
  with recent as (
    select p.id, p.author_id, p.kind, least(p.captured_at, p.created_at) as taken_at, p.crowd, p.conditions, p.vibes, p.tip, p.verified_area, a.username, c.trip_adds
      from public.posts p
      join public.post_counters c on c.post_id = p.id
      join public.profiles a on a.id = p.author_id
     where p.destination_id = _dest and p.status = 'visible' and p.moderation = 'approved' and p.created_at > now() - interval '30 days'
     order by p.created_at desc limit 300
  )
  select jsonb_build_object(
    'total_30d', (select count(*) from recent),
    'posts_24h', (select count(*) from recent where taken_at > now() - interval '24 hours'),
    'posts_7d', (select count(*) from recent where taken_at > now() - interval '7 days'),
    'videos_7d', (select count(*) from recent where kind = 'video' and taken_at > now() - interval '7 days'),
    'contributors_7d', (select count(distinct author_id) from recent where taken_at > now() - interval '7 days'),
    'from_area_7d', (select count(*) from recent where verified_area and taken_at > now() - interval '7 days'),
    'trip_adds_30d', (select coalesce(sum(trip_adds), 0) from recent),
    'crowd', (select coalesce(jsonb_agg(jsonb_build_object('level', crowd, 'at', taken_at) order by taken_at desc), '[]'::jsonb) from recent where crowd is not null and taken_at > now() - interval '3 days'),
    'conditions', (select coalesce(jsonb_agg(jsonb_build_object('id', cond, 'at', taken_at) order by taken_at desc), '[]'::jsonb) from recent, unnest(conditions) as cond where taken_at > now() - interval '3 days'),
    'vibes', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'n', v.n) order by v.n desc, v.id), '[]'::jsonb) from (select x as id, count(*) as n from recent, unnest(vibes) as x group by x order by count(*) desc, x limit 6) v),
    'tips', (select coalesce(jsonb_agg(jsonb_build_object('text', t.tip, 'at', t.taken_at, 'by', t.username) order by t.taken_at desc), '[]'::jsonb) from (select tip, taken_at, username from recent where tip is not null order by taken_at desc limit 5) t)
  )
$$;
revoke all on function public.destination_pulse(uuid) from public, anon;
grant execute on function public.destination_pulse(uuid) to authenticated;

-- ─── 6. The feed's read functions, with the new columns ──────────────────────
drop function if exists public.feed_candidates(uuid[], double precision, double precision, integer);
drop function if exists public.feed_items(uuid[]);

create function public.feed_items(_ids uuid[])
returns table (
  id uuid, author_id uuid, username text, display_name text, avatar_path text,
  destination_id uuid, destination_name text, destination_slug text, destination_posts integer,
  kind text, caption text, place_name text, lat double precision, lng double precision, location_precision text,
  captured_at timestamptz, created_at timestamptz, comments_allowed text, duration_s numeric,
  crowd text, conditions text[], vibes text[], tip text, verified_area boolean,
  likes integer, comments integer, saves integer, shares integer, helpful integer, trip_adds integer,
  impressions integer, plays integer, completions integer, skips integer, watch_ms bigint,
  followed boolean, liked boolean, saved boolean, helped boolean, seen_at timestamptz, seen_pct smallint
)
language sql stable set search_path = public, extensions as $$
  with me as (select (select auth.uid()) as uid)
  select p.id, p.author_id, a.username, a.display_name, a.avatar_path,
         p.destination_id, d.name, d.slug, d.post_count,
         p.kind, p.caption, p.place_name, p.lat, p.lng, p.location_precision,
         p.captured_at, p.created_at, p.comments_allowed,
         (select pm.duration_s from public.post_media pm where pm.post_id = p.id order by pm.position limit 1),
         p.crowd, p.conditions, p.vibes, p.tip, p.verified_area,
         c.likes, c.comments, c.saves, c.shares, c.helpful, c.trip_adds,
         c.impressions, c.plays, c.completions, c.skips, c.watch_ms,
         exists (select 1 from public.follows f where f.follower_id = (select uid from me) and f.followee_id = p.author_id and f.status = 'accepted'),
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = (select uid from me)),
         exists (select 1 from public.post_saves s where s.post_id = p.id and s.user_id = (select uid from me)),
         exists (select 1 from public.post_helpful h where h.post_id = p.id and h.user_id = (select uid from me)),
         v.last_seen_at, v.max_pct
    from public.posts p
    join public.post_counters c on c.post_id = p.id
    join public.profiles a on a.id = p.author_id
    join public.destinations d on d.id = p.destination_id
    left join public.post_views v on v.post_id = p.id and v.user_id = (select uid from me)
   where p.id = any (_ids[1:300])
     and p.status = 'visible' and p.moderation = 'approved'
     and not exists (select 1 from public.feed_hides h where h.user_id = (select uid from me)
                      and ((h.kind = 'post' and h.target_id = p.id) or (h.kind = 'author' and h.target_id = p.author_id) or (h.kind = 'destination' and h.target_id = p.destination_id)))
$$;

create or replace function public.feed_pool_ids(_dest uuid[], _lat double precision, _lng double precision, _limit integer default 60)
returns table (pool text, id uuid)
language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select (select auth.uid()) as uid, least(greatest(coalesce(_limit, 60), 10), 100) as lim,
           case when _lat is not null and _lng is not null then (st_setsrid(st_makepoint(_lng, _lat), 4326))::geography end as pt
  )
  (select 'destination', q.id from (
      select p.id, p.created_at
        from (select distinct u.id from unnest(coalesce(_dest, '{}'::uuid[])) as u(id) limit 12) d
        cross join lateral (
          select x.id, x.created_at from public.posts x join public.profiles a on a.id = x.author_id
           where x.destination_id = d.id and x.status = 'visible' and x.moderation = 'approved' and x.visibility = 'public' and not a.is_private
             and public.feed_cheap_ok(x.id, x.author_id, x.destination_id, (select uid from params))
           order by x.created_at desc, x.id desc limit 20) p
    ) q order by q.created_at desc, q.id desc limit (select lim from params))
  union all
  (select 'near', q.id from (
      select p.id, p.created_at
        from (select d.id from public.destinations d where (select pt from params) is not null and st_dwithin(d.geog, (select pt from params), 150000)
               order by st_distance(d.geog, (select pt from params)) limit 12) nd
        cross join lateral (
          select x.id, x.created_at from public.posts x join public.profiles a on a.id = x.author_id
           where x.destination_id = nd.id and x.status = 'visible' and x.moderation = 'approved' and x.visibility = 'public' and not a.is_private
             and public.feed_cheap_ok(x.id, x.author_id, x.destination_id, (select uid from params))
           order by x.created_at desc, x.id desc limit 10) p
    ) q order by q.created_at desc, q.id desc limit (select lim from params))
  union all
  (select 'following', q.id from (
      select p.id, p.created_at
        from (select f.followee_id from public.follows f where f.follower_id = (select uid from params) and f.status = 'accepted' order by f.created_at desc limit 100) fl
        cross join lateral (
          select x.id, x.created_at from public.posts x
           where x.author_id = fl.followee_id and x.status = 'visible' and x.moderation = 'approved' and x.destination_id is not null
             and public.feed_cheap_ok(x.id, x.author_id, x.destination_id, (select uid from params))
           order by x.created_at desc, x.id desc limit 10) p
    ) q order by q.created_at desc, q.id desc limit (select lim from params))
  union all
  (select 'trending', t.id from (
      -- rank the newest 1 500 public posts cheaply, keep a few times the page size, and only THEN run the per-post checks on those
      select r.id, r.author_id, r.destination_id, r.score from (
        select p.id, p.author_id, p.destination_id,
               (c.likes + 2 * c.saves + 3 * c.comments + 0.2 * c.plays + 3 * c.helpful + 4 * c.trip_adds) / power(extract(epoch from now() - p.created_at) / 3600 + 4, 1.3) as score
          from (select * from public.posts x
                 where x.status = 'visible' and x.moderation = 'approved' and x.destination_id is not null and x.visibility = 'public'
                   and x.created_at > now() - interval '14 days'
                 order by x.created_at desc limit 1500) p
          cross join lateral (select k.likes, k.saves, k.comments, k.plays, k.helpful, k.trip_adds from public.post_counters k where k.post_id = p.id limit 1) c
          cross join lateral (select not pr.is_private as ok from public.profiles pr where pr.id = p.author_id limit 1) a
         where a.ok
      ) r order by r.score desc, r.id limit (select lim from params) * 4
    ) t
    where public.feed_cheap_ok(t.id, t.author_id, t.destination_id, (select uid from params))
    order by t.score desc, t.id limit (select lim from params))
  union all
  (select 'fresh', f.id from (
      select x.id from public.posts x join public.profiles a on a.id = x.author_id
       where x.status = 'visible' and x.moderation = 'approved' and x.destination_id is not null and x.visibility = 'public' and not a.is_private
         and public.feed_cheap_ok(x.id, x.author_id, x.destination_id, (select uid from params))
       order by x.created_at desc, x.id desc limit (select lim from params)) f)
$$;


create function public.feed_candidates(_dest uuid[], _lat double precision, _lng double precision, _limit integer default 60)
returns table (
  pools text[], id uuid, author_id uuid, username text, display_name text, avatar_path text,
  destination_id uuid, destination_name text, destination_slug text, destination_posts integer,
  kind text, caption text, place_name text, lat double precision, lng double precision, location_precision text,
  captured_at timestamptz, created_at timestamptz, comments_allowed text, duration_s numeric,
  crowd text, conditions text[], vibes text[], tip text, verified_area boolean,
  likes integer, comments integer, saves integer, shares integer, helpful integer, trip_adds integer,
  impressions integer, plays integer, completions integer, skips integer, watch_ms bigint,
  followed boolean, liked boolean, saved boolean, helped boolean, seen_at timestamptz, seen_pct smallint
)
language sql stable set search_path = public, extensions as $$
  with picked as (select pl.id, array_agg(distinct pl.pool) as pools from public.feed_pool_ids(_dest, _lat, _lng, _limit) pl group by pl.id)
  select pk.pools, i.*
    from picked pk
    join public.feed_items((select array_agg(x.id) from picked x)) i on i.id = pk.id
$$;

revoke all on function public.feed_items(uuid[]), public.feed_candidates(uuid[], double precision, double precision, integer) from public, anon;
grant execute on function public.feed_items(uuid[]), public.feed_candidates(uuid[], double precision, double precision, integer) to authenticated;
revoke all on function public.feed_pool_ids(uuid[], double precision, double precision, integer) from public, anon;
grant execute on function public.feed_pool_ids(uuid[], double precision, double precision, integer) to authenticated;
