-- Real-database test for 20261024000000_place_search_and_trip_end.sql: trip end modes, and guest daily limits.
-- Prints "ALL PLACE SEARCH AND TRIP END CHECKS PASSED". Rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e0', 'ender@example.com');

do $$
declare ok boolean; n int; failed boolean;
begin
  -- end_mode: old trips (null) and the three modes are accepted
  insert into public.trips (id, owner_id, name, num_days) values ('10000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000e0', 'Old trip', 2);
  insert into public.trips (id, owner_id, name, num_days, end_mode) values ('10000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e0', 'Round trip', 2, 'start');
  insert into public.trips (id, owner_id, name, num_days, end_mode) values ('10000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e0', 'Open', 2, 'open');
  insert into public.trips (id, owner_id, name, num_days, end_mode, dest_name, dest_lat, dest_lng) values ('10000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e0', 'To Goa', 3, 'place', 'Panaji', 15.49, 73.83);

  -- an unknown mode is refused
  failed := false;
  begin
    insert into public.trips (owner_id, name, num_days, end_mode) values ('00000000-0000-4000-8000-0000000000e0', 'Bad', 1, 'somewhere');
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'end_mode accepted an unknown value'; end if;

  -- "end at a place" without the place is refused
  failed := false;
  begin
    insert into public.trips (owner_id, name, num_days, end_mode) values ('00000000-0000-4000-8000-0000000000e0', 'No point', 1, 'place');
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'end_mode = place accepted a trip with no end point'; end if;

  -- guest limits: 3 allowed, the 4th refused; another kind and another visitor are counted separately
  for i in 1..3 loop
    ok := public.consume_visitor_quota('visitor-aaaaaaaaaaaaaaaa', 'map', 3);
    if not ok then raise exception 'call % within the limit was refused', i; end if;
  end loop;
  if public.consume_visitor_quota('visitor-aaaaaaaaaaaaaaaa', 'map', 3) then raise exception 'call over the limit was allowed'; end if;
  if not public.consume_visitor_quota('visitor-aaaaaaaaaaaaaaaa', 'here', 3) then raise exception 'another kind shared the limit'; end if;
  if not public.consume_visitor_quota('visitor-bbbbbbbbbbbbbbbb', 'map', 3) then raise exception 'another visitor shared the limit'; end if;

  -- rows outside the window do not count, and rows older than 2 days are cleaned up
  update public.visitor_usage set created_at = now() - interval '3 days' where visitor_key = 'visitor-aaaaaaaaaaaaaaaa' and kind = 'map';
  if not public.consume_visitor_quota('visitor-aaaaaaaaaaaaaaaa', 'map', 3) then raise exception 'old calls still counted'; end if;
  select count(*) into n from public.visitor_usage where visitor_key = 'visitor-aaaaaaaaaaaaaaaa' and created_at < now() - interval '2 days';
  if n <> 0 then raise exception 'old rows were not cleaned up (% left)', n; end if;

  -- bad arguments are refused
  failed := false;
  begin perform public.consume_visitor_quota('short', 'map', 3); exception when sqlstate '22023' then failed := true; end;
  if not failed then raise exception 'a too-short visitor key was accepted'; end if;
end $$;

-- the app's own roles can neither call the function nor read the table
do $$
declare failed boolean;
begin
  failed := false;
  begin
    set local role anon;
    perform public.consume_visitor_quota('visitor-cccccccccccccccc', 'map', 3);
  exception when insufficient_privilege then failed := true; end;
  reset role;
  if not failed then raise exception 'anon could call consume_visitor_quota'; end if;

  failed := false;
  begin
    set local role authenticated;
    perform count(*) from public.visitor_usage;
  exception when insufficient_privilege then failed := true; end;
  reset role;
  if not failed then raise exception 'authenticated could read visitor_usage'; end if;
end $$;

select 'ALL PLACE SEARCH AND TRIP END CHECKS PASSED' as result;
rollback;
