# Trip plan feature — changes (round 2). Expand into the project root: it only replaces/adds files.

Checked: typecheck clean · lint 0 errors · 3,737 tests passed · `next build` OK.

## IMPORTANT: one database change
New column `trips.start_time` (migration `supabase/migrations/20261026000000_trip_start_time.sql`). Apply it:
    supabase db push
The app keeps working before you apply it (trips are created without the time, date changes still work), but "start today at 3:45 PM"
needs it.

## New in this round
1. Places are understood: a TOWN (e.g. Nalgonda) is a 30-minute stop, a big CITY (e.g. Visakhapatnam) gets about 2 hours with a note to
   add its sights. Sights inside a city (Charminar) are never mistaken for the city. Said on the places screen, in the "will it fit"
   meter and in the plan. (Our India place index with populations; a temple/beach/etc. or your own time always wins.)
2. Real start time: day 1 can start later than usual ("start today at 3:45 PM"). The planner gives day 1 only what is left of that day;
   every other day is normal. Too little daylight left (and night driving refused) → planned from the usual start, and it says why.
3. Smart start choices on the plan screen, from the clock + today's sunset + your night-driving answer:
   morning → "Start today at 8:30 AM"; late morning → "Start today at 10:30 AM"; afternoon → today (short) or tomorrow (best);
   night → only "Start tomorrow at 8:30 AM" and why. Dates over → "Do this trip again from…" with the same choices.
   "Day 1 starts at X, the time you chose" + "Use the usual start".
4. The AI reads WHEN you leave ("repu morning 6 am", "this Saturday"): kept only if your own words say it and it is a real future date;
   the save step shows "leaving 6:00 AM on day 1"; the time is saved for that date only.
5. The plan's notes (towns, start time, …) are now shown on the plan screen.

## Test on the phone
1. Hyderabad → Nalgonda: the places screen says Nalgonda is a town; the plan gives it a short stop.
2. Add "Visakhapatnam": it says it's a city; the plan keeps about 2 hours and asks you to add its sights.
3. A trip whose dates are over, opened at different times (morning / afternoon / night): the start choices change correctly.
4. Type "tomorrow 6 am Hyderabad nundi Srisailam 2 days": the save step shows tomorrow and "leaving 6:00 AM".
