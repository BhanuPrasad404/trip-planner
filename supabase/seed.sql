-- ============================================
-- SEED DATA — run AFTER schema.sql and AFTER you've signed up
-- one test user via Supabase Auth (Dashboard → Authentication → Users → Add user)
-- Replace 'YOUR_USER_ID' below with that user's UUID.
-- ============================================

-- A few real curated season tags (your actual moat data — expand this over time)
insert into season_tags (place_name, lat, lng, category, good_months, reason, region) values
  ('Kalu Waterfall', 18.7645, 73.4155, 'waterfall', array[6,7,8,9], 'Dry outside monsoon (Jun-Sep) — not worth visiting other months', 'Maharashtra'),
  ('Tiger''s Leap Viewpoint', 18.7333, 73.4064, 'viewpoint', array[1,2,3,4,5,6,7,8,9,10,11,12], null, 'Maharashtra'),
  ('Della Adventure Park', 18.7280, 73.4090, 'activity', array[1,2,3,4,5,6,7,8,9,10,11,12], null, 'Maharashtra'),
  ('Bhandardara', 19.5410, 73.7500, 'lake', array[6,7,8,9,10], 'Best right after monsoon when the dam is full', 'Maharashtra'),
  ('Rajmachi Fort', 18.7833, 73.3833, 'trek', array[6,7,8,9], 'Trail gets dangerously slippery outside monsoon prep season, best Jun-Sep', 'Maharashtra');

-- Demo trip — replace YOUR_USER_ID with a real auth.users.id
insert into trips (id, owner_id, name, start_city, start_lat, start_lng, start_date, num_days)
values (
  '00000000-0000-0000-0000-000000000001',
  'e32c45b1-ddc3-4dd5-bf80-d5df5a34ae07',
  'Hyderabad → Maharashtra',
  'Hyderabad',
  17.3850, 78.4867,
  current_date,
  6
);
insert into trip_members (trip_id, user_id, display_name, avatar_color) values
  ('00000000-0000-0000-0000-000000000001', 'e32c45b1-ddc3-4dd5-bf80-d5df5a34ae07', 'You', '#1C7C6D');

-- Sample places for Day 3, linked to the season tags above
insert into places (trip_id, name, lat, lng, day_number, sequence_order, arrival_time, season_tag_id)
select
  '00000000-0000-0000-0000-000000000001',
  st.place_name,
  st.lat,
  st.lng,
  3,
  row_number() over (),
  ('08:30'::time + (row_number() over () - 1) * interval '2.5 hours')::time,
  st.id
from season_tags st
where st.place_name in ('Tiger''s Leap Viewpoint', 'Kalu Waterfall', 'Della Adventure Park');
