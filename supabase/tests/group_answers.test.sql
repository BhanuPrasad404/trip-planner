-- Real-database test for 20261025000000_group_answers_and_trip_intake.sql: the group's answer link, who may answer, who may read.
-- Prints "ALL GROUP ANSWER CHECKS PASSED". Rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f0', 'owner@example.com'),
  ('00000000-0000-4000-8000-0000000000f1', 'friend@example.com'),
  ('00000000-0000-4000-8000-0000000000f2', 'stranger@example.com');
insert into public.trips (id, owner_id, name, num_days, intake) values
  ('10000000-0000-4000-8000-0000000000f0', '00000000-0000-4000-8000-0000000000f0', 'Goa with the gang', 4, '{"pace":"relaxed","interests":["beaches"]}');
insert into public.trip_members (trip_id, user_id, display_name) values
  ('10000000-0000-4000-8000-0000000000f0', '00000000-0000-4000-8000-0000000000f0', 'Owner'),
  ('10000000-0000-4000-8000-0000000000f0', '00000000-0000-4000-8000-0000000000f1', 'Friend')
on conflict do nothing;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true); end $$;

do $$
declare code text; code2 text; r jsonb; n int; failed boolean; ans uuid;
begin
  -- intake: an object only
  failed := false;
  begin update public.trips set intake = '[1,2]' where id = '10000000-0000-4000-8000-0000000000f0'; exception when check_violation then failed := true; end;
  if not failed then raise exception 'intake accepted a non-object'; end if;

  -- only the owner can open the link
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
  failed := false;
  begin set local role authenticated; perform public.set_trip_poll('10000000-0000-4000-8000-0000000000f0', true); exception when insufficient_privilege then failed := true; end;
  reset role;
  if not failed then raise exception 'a member who is not the owner opened the link'; end if;

  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000f0');
  set local role authenticated;
  select poll_code into code from public.set_trip_poll('10000000-0000-4000-8000-0000000000f0', true);
  reset role;
  if code !~ '^[a-f0-9]{16}$' then raise exception 'bad code %', code; end if;

  -- anyone can see the trip name and that it is open (nothing else)
  set local role anon;
  r := public.poll_lookup(code);
  reset role;
  if r->>'status' <> 'open' or r->>'trip_name' <> 'Goa with the gang' or r ? 'trip_id' then raise exception 'poll_lookup said %', r; end if;
  if public.poll_lookup('ffffffffffffffff')->>'status' <> 'invalid' then raise exception 'unknown code not invalid'; end if;

  -- a guest can't answer directly (no permission); only the server role can, with a visitor key
  failed := false;
  begin set local role anon; perform public.submit_guest_group_answer(code, 'visitor-aaaaaaaaaaaaaaaa', 'Ravi', '{"pace":"relaxed"}'); exception when insufficient_privilege then failed := true; end;
  reset role;
  if not failed then raise exception 'anon answered without the server'; end if;
  failed := false;
  begin set local role authenticated; perform public._save_group_answer(null, 'visitor-aaaaaaaaaaaaaaaa', code, 'Ravi', '{}'); exception when insufficient_privilege then failed := true; end;
  reset role;
  if not failed then raise exception 'the private save function was callable'; end if;

  set local role service_role;
  r := public.submit_guest_group_answer(code, 'visitor-aaaaaaaaaaaaaaaa', 'Ravi', '{"pace":"relaxed","interests":["food"]}');
  if r->>'status' <> 'saved' then raise exception 'guest save said %', r; end if;
  r := public.submit_guest_group_answer(code, 'visitor-aaaaaaaaaaaaaaaa', 'Ravi K', '{"pace":"packed"}');
  if r->>'status' <> 'updated' then raise exception 'guest update said %', r; end if;
  r := public.guest_group_answer(code, 'visitor-aaaaaaaaaaaaaaaa');
  if r->>'name' <> 'Ravi K' or r->'answers'->>'pace' <> 'packed' then raise exception 'guest own answer said %', r; end if;
  if public.submit_guest_group_answer(code, 'visitor-bbbbbbbbbbbbbbbb', '   ', '{}')->>'status' <> 'bad_name' then raise exception 'empty name accepted'; end if;
  reset role;

  -- a signed-in friend answers as themselves
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
  set local role authenticated;
  r := public.submit_group_answer(code, 'Friend', '{"pace":"relaxed","avoid":["night_driving"]}');
  if r->>'status' <> 'saved' then raise exception 'member save said %', r; end if;
  if public.my_group_answer(code)->>'name' <> 'Friend' then raise exception 'my answer not found'; end if;
  -- members read the trip's answers
  select count(*) into n from public.trip_group_answers where trip_id = '10000000-0000-4000-8000-0000000000f0';
  reset role;
  if n <> 2 then raise exception 'a member saw % answers, expected 2', n; end if;

  -- a stranger (signed in, not a member) reads nothing
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
  set local role authenticated;
  select count(*) into n from public.trip_group_answers;
  reset role;
  if n <> 0 then raise exception 'a stranger saw % answers', n; end if;
  -- anon can't read the table at all
  failed := false;
  begin set local role anon; perform count(*) from public.trip_group_answers; exception when insufficient_privilege then failed := true; end;
  reset role;
  if not failed then raise exception 'anon read the answers table'; end if;

  -- the owner switches the link off: no new answers; then a new link kills the old one
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000f0');
  set local role authenticated;
  perform public.set_trip_poll('10000000-0000-4000-8000-0000000000f0', false);
  reset role;
  set local role service_role;
  if public.submit_guest_group_answer(code, 'visitor-cccccccccccccccc', 'Late', '{}')->>'status' <> 'closed' then raise exception 'closed link accepted an answer'; end if;
  reset role;
  set local role authenticated;
  select poll_code into code2 from public.set_trip_poll('10000000-0000-4000-8000-0000000000f0', true, true);
  reset role;
  if code2 = code then raise exception 'new link kept the old code'; end if;
  if public.poll_lookup(code)->>'status' <> 'invalid' then raise exception 'old link still works'; end if;

  -- at most 30 answers per trip
  set local role service_role;
  for i in 1..28 loop
    r := public.submit_guest_group_answer(code2, 'visitor-' || lpad(i::text, 16, '0'), 'P' || i, '{}');
  end loop;
  if public.submit_guest_group_answer(code2, 'visitor-zzzzzzzzzzzzzzzz', 'One too many', '{}')->>'status' <> 'full' then raise exception 'the 31st answer was accepted'; end if;
  reset role;

  -- only the owner removes an answer
  select id into ans from public.trip_group_answers where display_name = 'Ravi K';
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
  set local role authenticated;
  if public.remove_group_answer(ans) then raise exception 'a non-owner removed an answer'; end if;
  reset role;
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000f0');
  set local role authenticated;
  if not public.remove_group_answer(ans) then raise exception 'the owner could not remove an answer'; end if;
  reset role;

  -- answers go with the trip
  delete from public.trips where id = '10000000-0000-4000-8000-0000000000f0';
  select count(*) into n from public.trip_group_answers;
  if n <> 0 then raise exception '% answers outlived their trip', n; end if;
end $$;

select 'ALL GROUP ANSWER CHECKS PASSED' as result;
rollback;
