-- ============================================================================
-- Traveler Media Network — foundation (profiles, follows, posts, media, likes, comments, saves, reports).
--
-- Design rules
--  * Opt-in identity: a profile row exists only when the person sets one up. Existing community
--    reports (place_reports) stay anonymous; nothing here changes them.
--  * Relationship model = FOLLOW (one-way; a private profile approves followers). "Private connections"
--    already exist: people who share a trip are in trip_members — no second friends table.
--  * Destination relevance comes from GEOGRAPHY (lat/lng + PostGIS), not a separate destinations table:
--    a trip stop / destination is a point, the feed asks "posts within N km of it".
--  * Freshness is honest: effective time = least(captured_at, created_at). A post can never look
--    fresher than the moment it was uploaded.
--  * Media bytes never touch Postgres (see next migration: private Storage bucket).
-- ============================================================================

-- ─── Profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name  text check (display_name is null or char_length(display_name) between 1 and 60),
  bio           text check (bio is null or char_length(bio) <= 160),
  avatar_path   text check (avatar_path is null or char_length(avatar_path) <= 200),
  interests     text[] not null default '{}' check (cardinality(interests) <= 8),
  is_private    boolean not null default false,   -- true: followers need approval and see your posts; others do not
  show_follow_lists boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists profiles_username_uq on public.profiles (lower(username));

-- ─── Follows ─────────────────────────────────────────────────────────────────
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'accepted' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id, status);

-- The client never chooses the status: following a private profile is always "pending".
create or replace function public.follows_set_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.status := case when (select is_private from public.profiles where id = new.followee_id) then 'pending' else 'accepted' end;
  return new;
end $$;
drop trigger if exists follows_set_status_trg on public.follows;
create trigger follows_set_status_trg before insert on public.follows for each row execute function public.follows_set_status();

-- ─── Posts (photo / video / short report) ────────────────────────────────────
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('photo', 'video', 'report')),
  caption       text check (caption is null or char_length(caption) <= 500),
  place_name    text not null check (char_length(place_name) between 1 and 120),
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  geog          extensions.geography(Point, 4326)
                generated always as ((extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326))::extensions.geography) stored,
  location_precision text not null default 'approx' check (location_precision in ('exact', 'approx')),
  captured_at   timestamptz not null default now(),
  visibility    text not null default 'public' check (visibility in ('public', 'followers')),
  comments_allowed text not null default 'everyone' check (comments_allowed in ('everyone', 'followers', 'off')),
  status        text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  created_at    timestamptz not null default now(),
  -- a "report" post must say something in words; photos/videos carry their media
  check (kind <> 'report' or caption is not null)
);
create index if not exists posts_geog_gix   on public.posts using gist (geog);
create index if not exists posts_feed_idx   on public.posts (created_at desc, id desc) where status = 'visible';
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

-- Privacy + honesty enforced in the database so no client can bypass them.
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
  else                                               -- people edit their words, never who/when/moderation state
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    if (select auth.uid()) is not null then new.status := old.status; end if;
  end if;
  new.captured_at := least(coalesce(new.captured_at, now()), now());   -- never in the future
  return new;
end $$;
drop trigger if exists posts_before_write_trg on public.posts;
create trigger posts_before_write_trg before insert or update on public.posts for each row execute function public.posts_before_write();

create table if not exists public.post_media (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  position     smallint not null default 0 check (position between 0 and 3),
  media_type   text not null check (media_type in ('image', 'video')),
  storage_path text not null check (char_length(storage_path) <= 200),
  poster_path  text check (poster_path is null or char_length(poster_path) <= 200),
  mime         text not null,
  bytes        integer not null check (bytes > 0),
  width        integer check (width is null or width > 0),
  height       integer check (height is null or height > 0),
  duration_s   numeric(6,1) check (duration_s is null or (duration_s > 0 and duration_s <= 120)),
  created_at   timestamptz not null default now(),
  unique (post_id, position)
);
create index if not exists post_media_path_idx on public.post_media (storage_path);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.post_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_saves_user_idx on public.post_saves (user_id, created_at desc);

create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  parent_id  uuid references public.post_comments(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

-- Replies are one level deep and stay on the same post.
create or replace function public.comment_one_level()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.post_comments p where p.id = new.parent_id and p.post_id = new.post_id and p.parent_id is null
  ) then
    raise exception 'replies must answer a top-level comment on the same post' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists comment_one_level_trg on public.post_comments;
create trigger comment_one_level_trg before insert on public.post_comments for each row execute function public.comment_one_level();

create table if not exists public.post_reports (
  post_id     uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('spam', 'inappropriate', 'misinformation', 'misleading_place', 'harassment', 'unsafe', 'other')),
  detail      text check (detail is null or char_length(detail) <= 300),
  created_at  timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

-- ─── Visibility helpers (SECURITY DEFINER so they can see what the caller's RLS cannot) ──────
create or replace function public.is_accepted_follower(_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = (select auth.uid()) and followee_id = _author and status = 'accepted')
$$;

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
           and (select count(*) from public.post_reports r where r.post_id = p.id) < 3     -- 3 reports hide it pending review
           and ((p.visibility = 'public' and not a.is_private) or public.is_accepted_follower(p.author_id))
         )
       )
  )
$$;

create or replace function public.can_comment_on(_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view_post(_post) and exists (
    select 1 from public.posts p
     where p.id = _post
       and (p.comments_allowed = 'everyone'
            or (p.comments_allowed = 'followers' and (p.author_id = (select auth.uid()) or public.is_accepted_follower(p.author_id))))
  )
$$;

revoke all on function public.is_accepted_follower(uuid), public.can_view_post(uuid), public.can_comment_on(uuid) from public, anon;
grant execute on function public.is_accepted_follower(uuid), public.can_view_post(uuid), public.can_comment_on(uuid) to authenticated;

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.follows       enable row level security;
alter table public.posts         enable row level security;
alter table public.post_media    enable row level security;
alter table public.post_likes    enable row level security;
alter table public.post_saves    enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_reports  enable row level security;

revoke all on public.profiles, public.follows, public.posts, public.post_media, public.post_likes, public.post_saves, public.post_comments, public.post_reports from anon;

-- profiles: identity (username, name, avatar, bio) is readable by signed-in people; you edit only your own.
drop policy if exists "Signed-in users read profiles" on public.profiles;
create policy "Signed-in users read profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "Create own profile" on public.profiles;
create policy "Create own profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "Delete own profile" on public.profiles;
create policy "Delete own profile" on public.profiles for delete to authenticated using (id = (select auth.uid()));

-- follows: you see rows you are part of. Lists/counts for others go through follow_counts() (respects show_follow_lists).
drop policy if exists "See my follow rows" on public.follows;
create policy "See my follow rows" on public.follows for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
drop policy if exists "Follow as myself" on public.follows;
create policy "Follow as myself" on public.follows for insert to authenticated with check (follower_id = (select auth.uid()));
-- only the person being followed can approve a pending request (status can only become 'accepted')
drop policy if exists "Approve requests to me" on public.follows;
create policy "Approve requests to me" on public.follows for update to authenticated
  using (followee_id = (select auth.uid())) with check (followee_id = (select auth.uid()) and status = 'accepted');
drop policy if exists "Unfollow or remove follower" on public.follows;
create policy "Unfollow or remove follower" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

-- posts
drop policy if exists "Read posts I may see" on public.posts;
create policy "Read posts I may see" on public.posts for select to authenticated using (public.can_view_post(id));
drop policy if exists "Post as myself" on public.posts;
create policy "Post as myself" on public.posts for insert to authenticated with check (author_id = (select auth.uid()));
drop policy if exists "Edit own posts" on public.posts;
create policy "Edit own posts" on public.posts for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
drop policy if exists "Delete own posts" on public.posts;
create policy "Delete own posts" on public.posts for delete to authenticated using (author_id = (select auth.uid()));

-- post_media
drop policy if exists "Read media of visible posts" on public.post_media;
create policy "Read media of visible posts" on public.post_media for select to authenticated using (public.can_view_post(post_id));
drop policy if exists "Add media to own posts" on public.post_media;
create policy "Add media to own posts" on public.post_media for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
              and (storage_path like (select auth.uid())::text || '/%'));
drop policy if exists "Delete media of own posts" on public.post_media;
create policy "Delete media of own posts" on public.post_media for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));

-- likes / saves: you only ever see your OWN rows; totals come from post_stats().
drop policy if exists "My likes" on public.post_likes;
create policy "My likes" on public.post_likes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Like as myself" on public.post_likes;
create policy "Like as myself" on public.post_likes for insert to authenticated with check (user_id = (select auth.uid()) and public.can_view_post(post_id));
drop policy if exists "Unlike" on public.post_likes;
create policy "Unlike" on public.post_likes for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "My saves" on public.post_saves;
create policy "My saves" on public.post_saves for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Save as myself" on public.post_saves;
create policy "Save as myself" on public.post_saves for insert to authenticated with check (user_id = (select auth.uid()) and public.can_view_post(post_id));
drop policy if exists "Unsave" on public.post_saves;
create policy "Unsave" on public.post_saves for delete to authenticated using (user_id = (select auth.uid()));

-- comments
drop policy if exists "Read comments of visible posts" on public.post_comments;
create policy "Read comments of visible posts" on public.post_comments for select to authenticated using (public.can_view_post(post_id));
drop policy if exists "Comment as myself" on public.post_comments;
create policy "Comment as myself" on public.post_comments for insert to authenticated with check (author_id = (select auth.uid()) and public.can_comment_on(post_id));
drop policy if exists "Delete my comment or comments on my post" on public.post_comments;
create policy "Delete my comment or comments on my post" on public.post_comments for delete to authenticated
  using (author_id = (select auth.uid()) or exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));

-- reports: write-only for users (you cannot see who else reported); review happens with the service role.
drop policy if exists "Report as myself" on public.post_reports;
create policy "Report as myself" on public.post_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and public.can_view_post(post_id));
drop policy if exists "See my own reports" on public.post_reports;
create policy "See my own reports" on public.post_reports for select to authenticated using (reporter_id = (select auth.uid()));

-- ─── Read helpers ────────────────────────────────────────────────────────────
-- Totals + "did I like/save it" for a page of posts in ONE query (no N+1, no public like lists).
create or replace function public.post_stats(_ids uuid[])
returns table (post_id uuid, likes bigint, comments bigint, liked boolean, saved boolean)
language sql stable security definer set search_path = public as $$
  select p.id,
         (select count(*) from public.post_likes l where l.post_id = p.id),
         (select count(*) from public.post_comments c where c.post_id = p.id),
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = (select auth.uid())),
         exists (select 1 from public.post_saves s where s.post_id = p.id and s.user_id = (select auth.uid()))
    from public.posts p
   where p.id = any (_ids[1:50]) and public.can_view_post(p.id)
$$;

create or replace function public.follow_counts(_user uuid)
returns table (followers bigint, following bigint)
language sql stable security definer set search_path = public as $$
  select case when _user = (select auth.uid()) or (select show_follow_lists from public.profiles where id = _user)
              then (select count(*) from public.follows where followee_id = _user and status = 'accepted') end,
         case when _user = (select auth.uid()) or (select show_follow_lists from public.profiles where id = _user)
              then (select count(*) from public.follows where follower_id = _user and status = 'accepted') end
$$;
revoke all on function public.post_stats(uuid[]), public.follow_counts(uuid) from public, anon;
grant execute on function public.post_stats(uuid[]), public.follow_counts(uuid) to authenticated;
