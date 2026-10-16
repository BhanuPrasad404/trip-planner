-- Leave a trip, remove a member, hand a trip over.
--
-- 1. Who may delete a membership. The old rule ("your own row, or you are the owner") let the OWNER delete their own membership,
--    leaving a trip whose owner is not on it. Now:
--      • a member may leave (their own row) — but the owner may not; they hand the trip over or delete it first;
--      • the owner may remove OTHER members;
--      • nobody else may remove anyone.
--    Deleting the whole trip (owner) and deleting an account (delete_my_account, which hands trips over first) are unaffected:
--    they do not go through this policy.
--
-- 2. What happens to the person's things in THAT trip when their membership ends (left, removed, or account deleted):
--      • live location: deleted at once (their dot disappears from the others' maps);
--      • location pings and votes: deleted (they are no longer part of the group's decision);
--      • trip media rows they uploaded: deleted (the server removes the stored files first);
--      • stops they added: KEPT on the trip — the plan belongs to the group — but no longer name them (added_by = null).
--    Nothing outside that trip is touched.
--
-- 3. transfer_trip_ownership(trip, new_owner): the owner hands the trip to someone who is already a member.
--
-- Additive: no table changes. Safe to re-run.

drop policy if exists "Leave trip or owner removes member" on public.trip_members;
drop policy if exists "Members leave, owner removes others" on public.trip_members;
create policy "Members leave, owner removes others" on public.trip_members
  for delete to authenticated
  using (
    (user_id = (select auth.uid()) and not public.is_trip_owner(trip_id))
    or (public.is_trip_owner(trip_id) and user_id <> (select auth.uid()))
  );

create or replace function public.trip_member_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.live_locations where trip_id = old.trip_id and user_id = old.user_id;
  delete from public.location_pings where trip_id = old.trip_id and user_id = old.user_id;
  delete from public.place_votes    where trip_id = old.trip_id and user_id = old.user_id;
  delete from public.trip_media     where trip_id = old.trip_id and uploaded_by = old.user_id;
  update public.places set added_by = null where trip_id = old.trip_id and added_by = old.user_id;
  return old;
end;
$$;
revoke all on function public.trip_member_left() from public, anon, authenticated;

drop trigger if exists trip_member_left_trg on public.trip_members;
create trigger trip_member_left_trg after delete on public.trip_members
  for each row execute function public.trip_member_left();

create or replace function public.transfer_trip_ownership(p_trip uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  -- Lock the trip row so two hand-overs (or a hand-over and a delete) cannot interleave.
  perform 1 from public.trips where id = p_trip and owner_id = uid for update;
  if not found then
    raise exception 'Only the trip owner can hand it over' using errcode = '42501';
  end if;
  if p_new_owner is null or p_new_owner = uid then
    raise exception 'Choose another member' using errcode = '22023';
  end if;
  if not exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_new_owner) then
    raise exception 'The new owner must already be a member of this trip' using errcode = 'P0002';
  end if;
  update public.trips set owner_id = p_new_owner where id = p_trip;
end;
$$;
revoke all on function public.transfer_trip_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_trip_ownership(uuid, uuid) to authenticated;

comment on function public.transfer_trip_ownership(uuid, uuid) is 'The trip owner hands the trip to another member. The old owner stays a member and may then leave.';
