-- ============================================================================
-- Destination feed — the database layer.
--
--  * destinations      A destination ("Matheran") is a first-class thing. Posts point at it by id; the SERVER decides which
--                      destination a post belongs to (resolve_destination), never the client.
--  * post_counters     Likes/comments/saves/views are kept as counters, updated atomically by triggers, so the feed never
--                      runs count(*) per post. Hot rows are isolated from `posts` (no write amplification on the big table).
--  * post_views        One rollup row per (user, post): the ONLY place views/watch-time are written, so a user cannot inflate
--                      anything by re-sending events. Feeds personalisation ("seen", destination affinity).
--  * user_blocks / feed_hides / posts.moderation   Safety controls enforced in the database (can_view_post), not in the app.
--  * feed_candidates() One query, five candidate pools, index-friendly; ranking happens in application code (lib/feed).
--
-- Not built on purpose (no benefit at this size): materialised trending, sharded counters, partitioned events, a cache layer.
-- ============================================================================

-- ─── Destinations ────────────────────────────────────────────────────────────
create table if not exists public.destinations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null check (char_length(slug) between 2 and 80),
  name       text not null check (char_length(name) between 2 and 120),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  geog       extensions.geography(Point, 4326)
             generated always as ((extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326))::extensions.geography) stored,
  post_count integer not null default 0 check (post_count >= 0),
  created_at timestamptz not null default now()
);
create index if not exists destinations_geog_gix on public.destinations using gist (geog);
create index if not exists destinations_slug_idx on public.destinations (slug);

alter table public.destinations enable row level security;
revoke all on public.destinations from anon;
drop policy if exists "Signed-in users read destinations" on public.destinations;
create policy "Signed-in users read destinations" on public.destinations for select to authenticated using (true);
-- No insert/update/delete policy: destinations are only created by resolve_destination() below.

-- The server asks "which destination is this post about?". Same name within 40 km => the same destination.
-- Race-safe (advisory lock per slug) and bounded (name length, coordinate ranges).
create or replace function public.resolve_destination(_name text, _lat double precision, _lng double precision)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(regexp_replace(coalesce(_name, ''), '\s+', ' ', 'g'));
  v_slug text;
  v_id uuid;
  v_pt extensions.geography;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if char_length(v_name) not between 2 and 120 then raise exception 'invalid destination name' using errcode = '22023'; end if;
  if _lat is null or _lng is null or _lat not between -90 and 90 or _lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  v_slug := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 80);
  if char_length(v_slug) < 2 then v_slug := 'd-' || left(md5(lower(v_name)), 12); end if;   -- names in other scripts

  perform pg_advisory_xact_lock(hashtextextended('destination:' || v_slug, 0));
  v_pt := (extensions.st_setsrid(extensions.st_makepoint(_lng, _lat), 4326))::extensions.geography;
  select d.id into v_id from public.destinations d
   where d.slug = v_slug and extensions.st_dwithin(d.geog, v_pt, 40000)
   order by extensions.st_distance(d.geog, v_pt) limit 1;
  if v_id is null then
    insert into public.destinations (slug, name, lat, lng) values (v_slug, v_name, round(_lat::numeric, 2), round(_lng::numeric, 2))
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.resolve_destination(text, double precision, double precision) from public, anon;
grant execute on function public.resolve_destination(text, double precision, double precision) to authenticated;

-- ─── Safety controls ─────────────────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon;
drop policy if exists "See my blocks" on public.user_blocks;
create policy "See my blocks" on public.user_blocks for select to authenticated using (blocker_id = (select auth.uid()));
drop policy if exists "Block as myself" on public.user_blocks;
create policy "Block as myself" on public.user_blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
drop policy if exists "Unblock" on public.user_blocks;
create policy "Unblock" on public.user_blocks for delete to authenticated using (blocker_id = (select auth.uid()));

-- Blocking ends any follow between the two people, in both directions.
create or replace function public.blocks_remove_follows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;
drop trigger if exists blocks_remove_follows_trg on public.user_blocks;
create trigger blocks_remove_follows_trg after insert on public.user_blocks for each row execute function public.blocks_remove_follows();

-- "Not interested": hide one post, everything from one author, or one destination — from MY feed only.
create table if not exists public.feed_hides (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('post', 'author', 'destination')),
  target_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target_id)
);
alter table public.feed_hides enable row level security;
revoke all on public.feed_hides from anon;
drop policy if exists "My hides" on public.feed_hides;
create policy "My hides" on public.feed_hides for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Hide as myself" on public.feed_hides;
create policy "Hide as myself" on public.feed_hides for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Unhide" on public.feed_hides;
create policy "Unhide" on public.feed_hides for delete to authenticated using (user_id = (select auth.uid()));

-- ─── Posts: destination + moderation state ───────────────────────────────────
alter table public.posts add column if not exists destination_id uuid references public.destinations(id) on delete restrict;
-- 'approved' today (every post is visible once published). The day automated moderation exists, new posts start as
-- 'pending' and a worker flips them — nothing else in the app has to change, because can_view_post() already checks it.
alter table public.posts add column if not exists moderation text not null default 'approved' check (moderation in ('pending', 'approved', 'rejected'));

create index if not exists posts_destination_feed_idx on public.posts (destination_id, created_at desc, id desc)
  where status = 'visible' and moderation = 'approved';

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
  else                                             -- people edit their words, never who/when/where/moderation state
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    if (select auth.uid()) is not null then
      new.status := old.status;
      new.moderation := old.moderation;
      new.destination_id := old.destination_id;
    end if;
  end if;
  new.captured_at := least(coalesce(new.captured_at, now()), now());   -- never in the future
  return new;
end $$;

-- Visibility now also honours moderation and blocks (either direction).
create or replace function public.can_view_post(_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.posts p
      join public.profiles a on a.id = p.author_id
     where p.id = _post
       and (
         p.author_id = (select auth.uid())
         or (
           p.status = 'visible'
           and p.moderation = 'approved'
           and (select count(*) from public.post_reports r where r.post_id = p.id) < 3     -- 3 reports hide it pending review
           and not exists (
             select 1 from public.user_blocks b
              where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.author_id)
                 or (b.blocker_id = p.author_id and b.blocked_id = (select auth.uid()))
           )
           and ((p.visibility = 'public' and not a.is_private) or public.is_accepted_follower(p.author_id))
         )
       )
  )
$$;

-- Destination post counts, kept by triggers.
create or replace function public.destination_post_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.destination_id is not null then
    update public.destinations set post_count = post_count + 1 where id = new.destination_id;
  elsif tg_op = 'DELETE' and old.destination_id is not null then
    update public.destinations set post_count = greatest(post_count - 1, 0) where id = old.destination_id;
  end if;
  return null;
end $$;
drop trigger if exists destination_post_count_trg on public.posts;
create trigger destination_post_count_trg after insert or delete on public.posts for each row execute function public.destination_post_count();

-- ─── Counters ────────────────────────────────────────────────────────────────
create table if not exists public.post_counters (
  post_id     uuid primary key references public.posts(id) on delete cascade,
  likes       integer not null default 0 check (likes >= 0),
  comments    integer not null default 0 check (comments >= 0),
  saves       integer not null default 0 check (saves >= 0),
  shares      integer not null default 0 check (shares >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  plays       integer not null default 0 check (plays >= 0),
  completions integer not null default 0 check (completions >= 0),
  skips       integer not null default 0 check (skips >= 0),
  watch_ms    bigint  not null default 0 check (watch_ms >= 0),
  updated_at  timestamptz not null default now()
);
alter table public.post_counters enable row level security;
revoke all on public.post_counters from anon;
drop policy if exists "Read counters of visible posts" on public.post_counters;
create policy "Read counters of visible posts" on public.post_counters for select to authenticated using (public.can_view_post(post_id));
-- No write policies: only the triggers / record_feed_events() below change counters.

insert into public.post_counters (post_id, likes, comments, saves)
select p.id,
       (select count(*) from public.post_likes l where l.post_id = p.id),
       (select count(*) from public.post_comments c where c.post_id = p.id),
       (select count(*) from public.post_saves s where s.post_id = p.id)
  from public.posts p
on conflict (post_id) do nothing;

update public.destinations d set post_count = (select count(*) from public.posts p where p.destination_id = d.id);

create or replace function public.posts_init_counters()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.post_counters (post_id) values (new.id) on conflict (post_id) do nothing;
  return null;
end $$;
drop trigger if exists posts_init_counters_trg on public.posts;
create trigger posts_init_counters_trg after insert on public.posts for each row execute function public.posts_init_counters();

-- Atomic ±1. Fires only when a row REALLY was inserted/deleted, so a duplicate like (ON CONFLICT DO NOTHING) changes nothing.
create or replace function public.bump_post_counter()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d integer := case tg_op when 'INSERT' then 1 else -1 end;
  pid uuid := case tg_op when 'INSERT' then new.post_id else old.post_id end;
begin
  if tg_table_name = 'post_likes' then
    update public.post_counters set likes = greatest(likes + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_saves' then
    update public.post_counters set saves = greatest(saves + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_comments' then
    update public.post_counters set comments = greatest(comments + d, 0), updated_at = now() where post_id = pid;
  end if;
  return null;
end $$;
drop trigger if exists bump_like_counter_trg on public.post_likes;
create trigger bump_like_counter_trg after insert or delete on public.post_likes for each row execute function public.bump_post_counter();
drop trigger if exists bump_save_counter_trg on public.post_saves;
create trigger bump_save_counter_trg after insert or delete on public.post_saves for each row execute function public.bump_post_counter();
drop trigger if exists bump_comment_counter_trg on public.post_comments;
create trigger bump_comment_counter_trg after insert or delete on public.post_comments for each row execute function public.bump_post_counter();

-- ─── Like / save: idempotent, race-safe ──────────────────────────────────────
-- Saying "liked = true" twice is the same as once; two devices racing cannot double-count (primary key + trigger on real rows only).
create or replace function public.set_post_reaction(_post uuid, _kind text, _on boolean)
returns table (changed boolean, likes integer, saves integer)
language plpgsql set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rows integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if _kind not in ('like', 'save') then raise exception 'unknown reaction' using errcode = '22023'; end if;
  if _on then
    if _kind = 'like' then insert into public.post_likes (post_id, user_id) values (_post, v_uid) on conflict do nothing;
    else insert into public.post_saves (post_id, user_id) values (_post, v_uid) on conflict do nothing; end if;
  else
    if _kind = 'like' then delete from public.post_likes where post_id = _post and user_id = v_uid;
    else delete from public.post_saves where post_id = _post and user_id = v_uid; end if;
  end if;
  get diagnostics v_rows = row_count;
  return query select v_rows > 0, c.likes, c.saves from public.post_counters c where c.post_id = _post;
end $$;
revoke all on function public.set_post_reaction(uuid, text, boolean) from public, anon;
grant execute on function public.set_post_reaction(uuid, text, boolean) to authenticated;

-- ─── Views / watch time: one rollup row per (user, post) ─────────────────────
create table if not exists public.post_views (
  user_id      uuid not null references auth.users(id) on delete cascade,
  post_id      uuid not null references public.posts(id) on delete cascade,
  impressed    boolean  not null default false,
  played       boolean  not null default false,
  completed    boolean  not null default false,
  skipped      boolean  not null default false,
  max_pct      smallint not null default 0 check (max_pct between 0 and 100),
  replays      smallint not null default 0 check (replays between 0 and 20),
  watch_ms     integer  not null default 0 check (watch_ms between 0 and 600000),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists post_views_user_recent_idx on public.post_views (user_id, last_seen_at desc);
alter table public.post_views enable row level security;
revoke all on public.post_views from anon;
drop policy if exists "My views" on public.post_views;
create policy "My views" on public.post_views for select to authenticated using (user_id = (select auth.uid()));
-- No write policies: record_feed_events() is the only writer.

-- A batch of meaningful moments (never one request per second of video):
--   impression | play | q25 | q50 | q75 | complete | replay | skip | leave     each with an optional `ms` watched.
-- Each milestone counts ONCE per user per post, your own posts never count, watch time is capped at 10 min per post per user.
create or replace function public.record_feed_events(_events jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  e jsonb;
  v_post uuid; v_type text; v_ms integer; v_add integer; v_pct integer;
  v public.post_views%rowtype;
  v_n integer := 0;
  d_imp integer; d_play integer; d_comp integer; d_skip integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if _events is null or jsonb_typeof(_events) <> 'array' then raise exception 'events must be an array' using errcode = '22023'; end if;

  for e in select x from jsonb_array_elements(_events) with ordinality as t(x, i) where i <= 50 order by i loop
    begin
      v_post := (e ->> 'post_id')::uuid;
      v_type := e ->> 'type';
      v_ms   := least(greatest(coalesce((e ->> 'ms')::integer, 0), 0), 120000);
    exception when invalid_text_representation or numeric_value_out_of_range then continue;
    end;
    if v_type is null or v_type not in ('impression', 'play', 'q25', 'q50', 'q75', 'complete', 'replay', 'skip', 'leave') then continue; end if;
    if not exists (select 1 from public.posts p where p.id = v_post and p.author_id <> v_uid) or not public.can_view_post(v_post) then continue; end if;

    insert into public.post_views (user_id, post_id) values (v_uid, v_post) on conflict do nothing;
    select * into v from public.post_views where user_id = v_uid and post_id = v_post for update;
    d_imp := 0; d_play := 0; d_comp := 0; d_skip := 0;

    if not v.impressed then v.impressed := true; d_imp := 1; end if;          -- anything implies it was on screen
    if v_type in ('play', 'q25', 'q50', 'q75', 'complete', 'replay') and not v.played then v.played := true; d_play := 1; end if;
    v_pct := case v_type when 'q25' then 25 when 'q50' then 50 when 'q75' then 75 when 'complete' then 100 else 0 end;
    v.max_pct := greatest(v.max_pct, v_pct);
    if v_type = 'complete' and not v.completed then v.completed := true; d_comp := 1; end if;
    if v_type = 'replay' then v.replays := least(v.replays + 1, 20); end if;
    v_add := least(v_ms, 600000 - v.watch_ms);
    v.watch_ms := v.watch_ms + v_add;
    if v_type = 'skip' and not v.skipped and not v.completed and v.watch_ms < 3000 then v.skipped := true; d_skip := 1; end if;

    update public.post_views
       set impressed = v.impressed, played = v.played, completed = v.completed, skipped = v.skipped,
           max_pct = v.max_pct, replays = v.replays, watch_ms = v.watch_ms, last_seen_at = now()
     where user_id = v_uid and post_id = v_post;
    update public.post_counters
       set impressions = impressions + d_imp, plays = plays + d_play, completions = completions + d_comp,
           skips = skips + d_skip, watch_ms = watch_ms + v_add, updated_at = now()
     where post_id = v_post;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.record_feed_events(jsonb) from public, anon;
grant execute on function public.record_feed_events(jsonb) to authenticated;

-- ─── Personalisation signals ────────────────────────────────────────────────
-- What this person engages with, by destination (last N days): likes ×1, saves ×2, watched-through ×1, started ×0.3.
create or replace function public.user_destination_affinity(_days integer default 90)
returns table (destination_id uuid, score real)
language sql stable set search_path = public as $$
  select s.destination_id, sum(s.w)::real
    from (
      select p.destination_id, 1.0 as w from public.post_likes l join public.posts p on p.id = l.post_id
       where l.user_id = (select auth.uid()) and l.created_at > now() - make_interval(days => least(greatest(_days, 1), 365))
      union all
      select p.destination_id, 2.0 from public.post_saves sv join public.posts p on p.id = sv.post_id
       where sv.user_id = (select auth.uid()) and sv.created_at > now() - make_interval(days => least(greatest(_days, 1), 365))
      union all
      select p.destination_id, case when v.completed then 1.0 else 0.3 end from public.post_views v join public.posts p on p.id = v.post_id
       where v.user_id = (select auth.uid()) and v.played and v.last_seen_at > now() - make_interval(days => least(greatest(_days, 1), 365))
    ) s
   where s.destination_id is not null
   group by s.destination_id
   order by 2 desc
   limit 20
$$;

-- Destinations within N km of a list of points (the stops of the trip being planned).
create or replace function public.destinations_near_points(_lats double precision[], _lngs double precision[], _radius_km integer default 40)
returns setof uuid
language sql stable set search_path = public as $$
  select distinct d.id
    from unnest(_lats[1:12], _lngs[1:12]) as t(lat, lng)
    join public.destinations d
      on extensions.st_dwithin(d.geog, (extensions.st_setsrid(extensions.st_makepoint(t.lng, t.lat), 4326))::extensions.geography, least(greatest(_radius_km, 1), 200) * 1000)
   where t.lat between -90 and 90 and t.lng between -180 and 180
$$;

-- ─── Feed rows ───────────────────────────────────────────────────────────────
-- The full row for a list of post ids: counters, author, destination, first-media duration and MY state (liked/saved/seen).
-- Runs as the caller, so RLS (can_view_post: visibility, moderation, blocks, reports) and my "not interested" hides apply.
-- Used for ranked candidates AND for later pages of a feed (a page = ids picked earlier; anything deleted/hidden since drops out).
create or replace function public.feed_items(_ids uuid[])
returns table (
  id uuid, author_id uuid, username text, display_name text, avatar_path text,
  destination_id uuid, destination_name text, destination_slug text, destination_posts integer,
  kind text, caption text, place_name text, lat double precision, lng double precision, location_precision text,
  captured_at timestamptz, created_at timestamptz, comments_allowed text, duration_s numeric,
  likes integer, comments integer, saves integer, shares integer, impressions integer, plays integer, completions integer, skips integer, watch_ms bigint,
  followed boolean, liked boolean, saved boolean, seen_at timestamptz, seen_pct smallint
)
language sql stable set search_path = public, extensions as $$
  with me as (select (select auth.uid()) as uid)
  select p.id, p.author_id, a.username, a.display_name, a.avatar_path,
         p.destination_id, d.name, d.slug, d.post_count,
         p.kind, p.caption, p.place_name, p.lat, p.lng, p.location_precision,
         p.captured_at, p.created_at, p.comments_allowed,
         (select pm.duration_s from public.post_media pm where pm.post_id = p.id order by pm.position limit 1),
         c.likes, c.comments, c.saves, c.shares, c.impressions, c.plays, c.completions, c.skips, c.watch_ms,
         exists (select 1 from public.follows f where f.follower_id = (select uid from me) and f.followee_id = p.author_id and f.status = 'accepted'),
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = (select uid from me)),
         exists (select 1 from public.post_saves s where s.post_id = p.id and s.user_id = (select uid from me)),
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

-- ─── Candidate generation ────────────────────────────────────────────────────
-- Five pools so a brand-new user still gets content: trip/saved destinations, near me, people I follow, trending, newest.
--
-- WHY TWO STEPS: row-level security runs can_view_post() (four sub-queries) on every post the database SCANS, before our own
-- filters. That is fine for "newest 60" but ruinous for "near me" or "trending", which must scan thousands. So:
--   1. feed_pool_ids()  (SECURITY DEFINER) PROPOSES ids using cheap, indexable rules that mirror can_view_post: public + approved +
--      not blocked + fewer than 3 reports + not hidden by me. It returns ids only.
--   2. feed_items()     (SECURITY INVOKER) loads the ≤300 proposed ids under the caller's real RLS. Anything that should not be
--      visible simply disappears here. Step 1 can only ever be too generous, never leak: step 2 is the gate.
-- Trending looks at the newest 1 500 posts of the last 14 days (bounded work however big the table grows); a precomputed table
-- replaces it when the numbers justify one.
-- The per-post checks the pools can afford (RLS repeats them, authoritatively, in feed_items). Not callable by app users.
create or replace function public.feed_cheap_ok(_post uuid, _author uuid, _dest uuid, _uid uuid)
returns boolean language sql stable set search_path = public as $$
  select (select count(*) from public.post_reports r where r.post_id = _post) < 3
     and not exists (select 1 from public.user_blocks b
                      where (b.blocker_id = _uid and b.blocked_id = _author) or (b.blocker_id = _author and b.blocked_id = _uid))
     and not exists (select 1 from public.feed_hides h where h.user_id = _uid
                      and ((h.kind = 'post' and h.target_id = _post) or (h.kind = 'author' and h.target_id = _author) or (h.kind = 'destination' and h.target_id = _dest)))
$$;
revoke all on function public.feed_cheap_ok(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Each selective pool is DRIVEN by its small input (my destinations, nearby destinations, the people I follow) and takes the newest few
-- posts of each, so its cost depends on how many of THOSE there are — never on how many posts exist. (Driving them from a scan of all
-- posts by date made a user who follows nobody cost a full table scan: measured 115 ms at 100k posts and growing.)
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
               (c.likes + 2 * c.saves + 3 * c.comments + 0.2 * c.plays) / power(extract(epoch from now() - p.created_at) / 3600 + 4, 1.3) as score
          from (select * from public.posts x
                 where x.status = 'visible' and x.moderation = 'approved' and x.destination_id is not null and x.visibility = 'public'
                   and x.created_at > now() - interval '14 days'
                 order by x.created_at desc limit 1500) p
          cross join lateral (select k.likes, k.saves, k.comments, k.plays from public.post_counters k where k.post_id = p.id limit 1) c
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

create or replace function public.feed_candidates(_dest uuid[], _lat double precision, _lng double precision, _limit integer default 60)
returns table (
  pools text[], id uuid, author_id uuid, username text, display_name text, avatar_path text,
  destination_id uuid, destination_name text, destination_slug text, destination_posts integer,
  kind text, caption text, place_name text, lat double precision, lng double precision, location_precision text,
  captured_at timestamptz, created_at timestamptz, comments_allowed text, duration_s numeric,
  likes integer, comments integer, saves integer, shares integer, impressions integer, plays integer, completions integer, skips integer, watch_ms bigint,
  followed boolean, liked boolean, saved boolean, seen_at timestamptz, seen_pct smallint
)
language sql stable set search_path = public, extensions as $$
  with picked as (select pl.id, array_agg(distinct pl.pool) as pools from public.feed_pool_ids(_dest, _lat, _lng, _limit) pl group by pl.id)
  select pk.pools, i.*
    from picked pk
    join public.feed_items((select array_agg(x.id) from picked x)) i on i.id = pk.id
$$;

revoke all on function public.feed_pool_ids(uuid[], double precision, double precision, integer) from public, anon;
grant execute on function public.feed_pool_ids(uuid[], double precision, double precision, integer) to authenticated;
revoke all on function public.feed_items(uuid[]), public.feed_candidates(uuid[], double precision, double precision, integer) from public, anon;
grant execute on function public.feed_items(uuid[]), public.feed_candidates(uuid[], double precision, double precision, integer) to authenticated;
revoke all on function public.user_destination_affinity(integer), public.destinations_near_points(double precision[], double precision[], integer) from public, anon;
grant execute on function public.user_destination_affinity(integer), public.destinations_near_points(double precision[], double precision[], integer) to authenticated;
