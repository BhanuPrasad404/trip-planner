-- "Delete my account" (Privacy: the right to erase your data).
--
-- Why a database function and not just `delete from auth.users`: five links to the user have NO "on delete cascade" (found by
-- asking the database): trips.owner_id, trip_members.user_id, location_pings.user_id, trip_media.uploaded_by and places.added_by.
-- A plain delete would FAIL for anyone who owns or has joined a trip. This function deals with those first, in a safe order:
--
--   1. A trip you own that other people are on is HANDED OVER to the member who has been on it longest (their trip must not vanish
--      because you left). A trip only you are on is deleted with everything on it (stops, votes, live positions).
--   2. Your memberships, location pings and trip photos are removed; stops you added stay on the group's trip with no author.
--   3. Notifications that mention you as the actor are removed from other people's inboxes.
--   4. Finally the account row is deleted; everything else you own (profile, posts and their media rows, comments, likes, saves,
--      votes, reports, feedback, live position, blocks, hides, notifications) goes with it through the existing cascades.
--
-- Files in Storage cannot be removed from SQL; the server route removes them first (app/api/account/delete).
-- Only the signed-in person can run it, and only on themselves (auth.uid()); there is no argument to point it at someone else.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid  uuid := auth.uid();
  t    record;
  heir uuid;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  for t in select id from public.trips where owner_id = uid loop
    select m.user_id into heir
      from public.trip_members m
     where m.trip_id = t.id and m.user_id <> uid
     order by m.joined_at asc, m.user_id asc
     limit 1;
    if heir is null then
      delete from public.trips where id = t.id;
    else
      update public.trips set owner_id = heir where id = t.id;
    end if;
  end loop;

  delete from public.trip_members  where user_id = uid;
  delete from public.location_pings where user_id = uid;
  delete from public.trip_media    where uploaded_by = uid;
  update public.places set added_by = null where added_by = uid;
  delete from public.notifications where actor_user = uid;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is 'Deletes the calling user''s account and personal data. Hands over shared trips. Storage files are removed by the server first.';
