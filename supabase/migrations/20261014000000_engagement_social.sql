-- ============================================================================
-- Engagement for the destination feed: notifications, "who liked my post", and the pieces that make saved posts / deleting posts safe.
--
--  * notifications   Written ONLY by triggers (a like or a comment on your post), never by clients. You can read and clear your own.
--                    A like notifies once however many times someone likes/unlikes (unique index), nobody is notified about
--                    their own actions, and blocked people never notify each other.
--  * post_likers()   The list of who liked a post — visible to the post's AUTHOR only. Likes stay private to everyone else.
--  * mark_notifications_read()   Marks your own notifications read; the only way read state changes.
-- ============================================================================

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,        -- who is told
  actor_user  uuid not null,                                                    -- who did it (kept even if they have no profile)
  kind        text not null check (kind in ('like', 'comment', 'reply')),
  post_id     uuid not null references public.posts(id) on delete cascade,
  comment_id  uuid references public.post_comments(id) on delete cascade,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user_recent_idx on public.notifications (user_id, created_at desc, id desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
-- However many times a like is toggled, the author hears about it once.
create unique index if not exists notifications_one_like_uq on public.notifications (user_id, actor_user, post_id) where kind = 'like';

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
drop policy if exists "Read my notifications" on public.notifications;
create policy "Read my notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Clear my notifications" on public.notifications;
create policy "Clear my notifications" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
-- No insert/update policy: only the triggers below create them, only mark_notifications_read() changes them.

create or replace function public.notify_blocked(_a uuid, _b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks b where (b.blocker_id = _a and b.blocked_id = _b) or (b.blocker_id = _b and b.blocked_id = _a))
$$;
revoke all on function public.notify_blocked(uuid, uuid) from public, anon, authenticated;

create or replace function public.notify_on_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.user_id or public.notify_blocked(v_author, new.user_id) then return null; end if;
  insert into public.notifications (user_id, actor_user, kind, post_id) values (v_author, new.user_id, 'like', new.post_id) on conflict do nothing;
  return null;
end $$;
drop trigger if exists notify_on_like_trg on public.post_likes;
create trigger notify_on_like_trg after insert on public.post_likes for each row execute function public.notify_on_like();

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_parent_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if new.parent_id is not null then select author_id into v_parent_author from public.post_comments where id = new.parent_id; end if;
  -- an answer to someone's comment tells THEM ('reply'); the post's author is told once, as 'reply' if it was theirs, else 'comment'
  if v_parent_author is not null and v_parent_author <> new.author_id and not public.notify_blocked(v_parent_author, new.author_id) then
    insert into public.notifications (user_id, actor_user, kind, post_id, comment_id) values (v_parent_author, new.author_id, 'reply', new.post_id, new.id);
  end if;
  if v_author is not null and v_author <> new.author_id and v_author is distinct from v_parent_author and not public.notify_blocked(v_author, new.author_id) then
    insert into public.notifications (user_id, actor_user, kind, post_id, comment_id) values (v_author, new.author_id, 'comment', new.post_id, new.id);
  end if;
  return null;
end $$;
drop trigger if exists notify_on_comment_trg on public.post_comments;
create trigger notify_on_comment_trg after insert on public.post_comments for each row execute function public.notify_on_comment();

-- Mark mine read (all, or just these). Returns how many changed.
create or replace function public.mark_notifications_read(_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and read_at is null and (_ids is null or id = any (_ids[1:200]));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Who liked MY post. Anyone else asking gets nothing (not an error: the post's existence is not revealed).
create or replace function public.post_likers(_post uuid, _limit integer default 30, _before timestamptz default null)
returns table (user_id uuid, username text, display_name text, liked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.user_id, pr.username, pr.display_name, l.created_at
    from public.post_likes l
    left join public.profiles pr on pr.id = l.user_id
   where l.post_id = _post
     and exists (select 1 from public.posts p where p.id = _post and p.author_id = (select auth.uid()))
     and (_before is null or l.created_at < _before)
   order by l.created_at desc, l.user_id
   limit least(greatest(coalesce(_limit, 30), 1), 100)
$$;
revoke all on function public.post_likers(uuid, integer, timestamptz) from public, anon;
grant execute on function public.post_likers(uuid, integer, timestamptz) to authenticated;

-- ─── Deleting a post or an ACCOUNT removes posts, likes and comments in one cascade. A counter update that lands on a post which is
-- ─── already gone must do nothing (it used to raise a foreign-key error when several people's data was removed together).
create or replace function public.bump_post_counter()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d integer := case tg_op when 'INSERT' then 1 else -1 end;
  pid uuid := case tg_op when 'INSERT' then new.post_id else old.post_id end;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.posts where id = pid) then return null; end if;
  if tg_table_name = 'post_likes' then
    update public.post_counters set likes = greatest(likes + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_saves' then
    update public.post_counters set saves = greatest(saves + d, 0), updated_at = now() where post_id = pid;
  elsif tg_table_name = 'post_comments' then
    update public.post_counters set comments = greatest(comments + d, 0), updated_at = now() where post_id = pid;
  end if;
  return null;
end $$;
