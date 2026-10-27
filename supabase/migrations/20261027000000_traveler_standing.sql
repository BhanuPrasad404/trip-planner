-- ============================================================================
-- Traveler standing: how many DIFFERENT travelers a person's posts have really helped, and where.
--
-- "Helped" is counted from what other travelers DID, never from what the author says:
--   • marked one of their posts "This helped me decide" (post_helpful), or
--   • added the place from one of their posts to their own trip (post_trip_adds).
-- Rules that keep the number honest:
--   • one person counts ONCE per author, however many of that author's posts they thank (ten thanks from a friend = 1);
--   • nobody counts for themselves (the tables already refuse it; the query checks again);
--   • only posts that are visible and approved count (a removed or moderated post stops counting at once);
--   • a profile that hides its follow lists also hides its follower numbers;
--   • the place named on a badge ("Local voice: Araku") is taken from public posts only, never from followers-only ones.
-- The badge names and thresholds live in lib/social/standing.ts (the database only counts).
--
-- Speed: called with the authors of ONE feed page (at most 60 ids). Each author is reached through posts_author_idx, each post's
-- marks through the primary keys of post_helpful / post_trip_adds. A server-side cache in front of it means a busy author is not
-- recounted on every page. If one day an author has hundreds of thousands of helpers, a maintained table replaces this query and
-- the function's shape stays the same.
-- ============================================================================

create index if not exists post_trip_adds_post_idx on public.post_trip_adds (post_id);   -- (the primary key already starts with post_id; kept explicit for clarity)

create or replace function public.traveler_standing(_authors uuid[])
returns table (
  author_id uuid,
  helped integer,
  posts integer,
  followers integer,
  following integer,
  top_destination_id uuid,
  top_destination_name text,
  top_destination_helped integer
)
language sql stable security definer set search_path = public as $$
  with a as (
    select distinct x.id from unnest(coalesce(_authors, '{}')) as x(id)
    limit 60
  ),
  vis as (
    select p.id, p.author_id, p.destination_id, p.visibility = 'public' as is_public
      from public.posts p join a on a.id = p.author_id
     where p.status = 'visible' and p.moderation = 'approved'
  ),
  helpers as (
    select v.author_id, v.destination_id, v.is_public, h.user_id from vis v join public.post_helpful h on h.post_id = v.id where h.user_id <> v.author_id
    union
    select v.author_id, v.destination_id, v.is_public, t.user_id from vis v join public.post_trip_adds t on t.post_id = v.id where t.user_id <> v.author_id
  ),
  per_author as (select h.author_id, count(distinct h.user_id)::int as n from helpers h group by h.author_id),
  per_place as (
    select h.author_id, h.destination_id, count(distinct h.user_id)::int as n,
           row_number() over (partition by h.author_id order by count(distinct h.user_id) desc, h.destination_id) as rn
      from helpers h where h.is_public group by h.author_id, h.destination_id     -- the place named on a badge comes from PUBLIC posts only
  ),
  post_n as (select v.author_id, count(*)::int as n from vis v group by v.author_id),
  fol as (select f.followee_id as id, count(*)::int as n from public.follows f join a on a.id = f.followee_id where f.status = 'accepted' group by f.followee_id),
  fng as (select f.follower_id as id, count(*)::int as n from public.follows f join a on a.id = f.follower_id where f.status = 'accepted' group by f.follower_id)
  select a.id,
         coalesce(pa.n, 0),
         coalesce(pn.n, 0),
         case when pr.show_follow_lists or a.id = (select auth.uid()) then coalesce(fol.n, 0) end,
         case when pr.show_follow_lists or a.id = (select auth.uid()) then coalesce(fng.n, 0) end,
         pp.destination_id,
         d.name,
         coalesce(pp.n, 0)
    from a
    join public.profiles pr on pr.id = a.id
    left join per_author pa on pa.author_id = a.id
    left join post_n pn on pn.author_id = a.id
    left join fol on fol.id = a.id
    left join fng on fng.id = a.id
    left join per_place pp on pp.author_id = a.id and pp.rn = 1
    left join public.destinations d on d.id = pp.destination_id
$$;

revoke all on function public.traveler_standing(uuid[]) from public, anon;
grant execute on function public.traveler_standing(uuid[]) to authenticated;
