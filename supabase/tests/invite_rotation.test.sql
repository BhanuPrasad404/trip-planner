-- Real-database test for 20261023000000_invite_rotation_expiry.sql: a new link kills the old one at once, expiry, throttled joining.
-- Prints "ALL INVITE ROTATION CHECKS PASSED". Rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b0', 'owner@example.com'),
  ('00000000-0000-4000-8000-0000000000b1', 'early@example.com'),
  ('00000000-0000-4000-8000-0000000000b2', 'late@example.com'),
  ('00000000-0000-4000-8000-0000000000b3', 'guesser@example.com'),
  ('00000000-0000-4000-8000-0000000000b4', 'bystander@example.com');
insert into public.trips (id, owner_id, name, num_days, invite_code) values
  ('10000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000b0', 'Hampi', 2, 'oldcode123456');
insert into public.trip_members (trip_id, user_id, display_name) values
  ('10000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000b0', 'Owner')
on conflict do nothing;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true); end $$;
create function pg_temp.join(u uuid, code text) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user(u);
  set local role authenticated;
  r := public.join_trip_with_invite(code);
  reset role;
  return r->>'status';
end $$;
create function pg_temp.rotate(u uuid, hours int) returns text language plpgsql as $$
declare c text;
begin
  perform pg_temp.as_user(u);
  set local role authenticated;
  begin
    select invite_code into c from public.rotate_trip_invite('10000000-0000-4000-8000-0000000000b0', hours);
    reset role;
    return c;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate;
  end;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

do $$
declare
  T uuid := '10000000-0000-4000-8000-0000000000b0';
  O uuid := '00000000-0000-4000-8000-0000000000b0'; E uuid := '00000000-0000-4000-8000-0000000000b1';
  L uuid := '00000000-0000-4000-8000-0000000000b2'; G uuid := '00000000-0000-4000-8000-0000000000b3'; B uuid := '00000000-0000-4000-8000-0000000000b4';
  c1 text; c2 text; n int; denied boolean;
begin
  -- Permissions.
  assert not has_function_privilege('anon', 'public.rotate_trip_invite(uuid, integer)', 'execute'), 'anon must not rotate';
  assert not has_function_privilege('anon', 'public.join_trip_with_invite(text)', 'execute'), 'anon must not join';

  -- The early member joins with the original link.
  assert pg_temp.join(E, 'oldcode123456') = 'joined', 'original link works';
  assert pg_temp.join(E, 'oldcode123456') = 'already_member', 'joining twice is harmless';

  -- Only the owner can make a new link.
  assert pg_temp.rotate(E, null) = 'ERR:42501', 'a member must not rotate';
  assert pg_temp.rotate(B, null) = 'ERR:42501', 'a stranger must not rotate';
  assert pg_temp.rotate(O, 0) = 'ERR:22023', 'nonsense expiry refused';
  assert (select invite_code from public.trips where id = T) = 'oldcode123456', 'refused rotations changed nothing';

  -- New link: the old one dies at once, the new one works, earlier members stay.
  c1 := pg_temp.rotate(O, null);
  assert length(c1) = 16 and c1 ~ '^[0-9a-f]+$', 'a long random code';
  assert pg_temp.join(L, 'oldcode123456') = 'invalid', 'the OLD link stops working at once';
  assert (select count(*) from public.trip_members where trip_id = T and user_id = L) = 0, 'nobody added by the old link';
  assert pg_temp.join(L, c1) = 'joined', 'the new link works';
  assert (select count(*) from public.trip_members where trip_id = T and user_id = E) = 1, 'early member stays';

  -- Expiry: a link with an expiry works until then, and not after; members already in are not shut out.
  c2 := pg_temp.rotate(O, 24);
  assert (select invite_expires_at from public.trips where id = T) between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute', 'expires in 24 h';
  update public.trips set invite_expires_at = now() - interval '1 minute' where id = T;   -- time passes
  assert pg_temp.join(B, c2) = 'expired', 'an expired link is refused';
  assert (select count(*) from public.trip_members where trip_id = T and user_id = B) = 0, 'nobody added by an expired link';
  assert pg_temp.join(L, c2) = 'already_member', 'a member opening an expired link still gets in';
  assert pg_temp.join(B, c1) = 'invalid', 'the link before that is still dead';

  -- Throttling: 10 failed attempts in an hour → refused even with the right code, and attempts are really recorded.
  c2 := pg_temp.rotate(O, null);
  for i in 1..10 loop
    assert pg_temp.join(G, 'guess' || lpad(i::text, 8, '0')) = 'invalid', 'wrong guesses are refused';
  end loop;
  select count(*) into n from public.invite_attempts where user_id = G;
  assert n = 10, 'every failed attempt is recorded (not rolled back)';
  assert pg_temp.join(G, c2) = 'too_many_attempts', 'after 10 failures even the RIGHT code is refused';
  assert (select count(*) from public.trip_members where trip_id = T and user_id = G) = 0, 'the guesser is not in';
  assert pg_temp.join(B, c2) = 'joined', 'another person is not affected';
  -- An hour later the guesser may try again.
  update public.invite_attempts set at = now() - interval '61 minutes' where user_id = G;
  assert pg_temp.join(G, c2) = 'joined', 'the limit lifts after an hour';

  -- The old entry point follows the same rules (null instead of an error), and records its failures too.
  select count(*) into n from public.invite_attempts where user_id = B;
  perform pg_temp.as_user(B);
  set local role authenticated;
  assert public.join_trip_by_code(c2) = T, 'old function: member → the trip id';
  assert public.join_trip_by_code('nope00000000') is null, 'old function: wrong code → null, no error';
  reset role;
  assert (select count(*) from public.invite_attempts where user_id = B) = n + 1, 'old function records failures';

  -- The attempts table is invisible to app users.
  perform pg_temp.as_user(G);
  set local role authenticated;
  denied := false;
  begin perform count(*) from public.invite_attempts; exception when insufficient_privilege then denied := true; end;
  reset role;
  assert denied, 'users must not read invite_attempts';
end $$;

select 'ALL INVITE ROTATION CHECKS PASSED';
rollback;
