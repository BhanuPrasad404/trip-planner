-- Update 52 audit hardening. Additive and backward compatible: only tightens what a signed-in user can change through the
-- database API directly. Nothing here deletes or rewrites existing rows.

-- 1. trip_members: a member could PATCH their own row's trip_id to ANY trip and become a member of it (is_trip_member would
--    then be true), skipping the invite flow. Membership identity columns are now immutable; only profile columns may change.
create or replace function public.trip_members_lock_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  new.trip_id := old.trip_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;
  return new;
end $$;
drop trigger if exists trip_members_lock_identity_trg on public.trip_members;
create trigger trip_members_lock_identity_trg before update on public.trip_members
  for each row execute function public.trip_members_lock_identity();

-- 2. follows: the followee could rewrite follower_id on a pending row and force-follow any user. Both ids are immutable.
create or replace function public.follows_lock_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  new.follower_id := old.follower_id;
  new.followee_id := old.followee_id;
  return new;
end $$;
drop trigger if exists follows_lock_identity_trg on public.follows;
create trigger follows_lock_identity_trg before update on public.follows
  for each row execute function public.follows_lock_identity();

-- 3. post_media: poster_path was never checked, so a row could point at ANOTHER user's private object and the
--    "read media of visible posts" storage policy would then expose it. Require it to live in the author's own folder.
drop policy if exists "Add media to own posts" on public.post_media;
create policy "Add media to own posts" on public.post_media for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
              and (storage_path like (select auth.uid())::text || '/%')
              and (poster_path is null or poster_path like (select auth.uid())::text || '/%'));
