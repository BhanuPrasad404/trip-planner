# Product value roadmap (derived from this audit)

Priorities are judgement, not measurement. The metrics are proposals; no usage data exists yet.

| Pri | Improvement | User problem | Complexity | Free tier | Metric / validation |
|---|---|---|---|---|---|
| 1 | Apply and test migration 20261017 on staging; add executed RLS tests (`supabase/tests`) for trip_members, follows, post_media | Another user can enter or read my trip | S | yes | SQL tests green on staging |
| 2 | Real-phone drive test with the arrival/backoff fixes | Wrong "you've arrived", dead navigation | S (manual) | yes | Checklist in docs/MOBILE_TESTING.md |
| 3 | Invite expiry, rotation and throttling in `join_trip_by_code` | Old or guessable links keep access | M | yes | Expired link rejected; SQL test |
| 4 | Post creation through an RPC (quota, destination resolve, media verify) | Quotas bypassable via direct inserts | M | yes | Direct insert denied |
| 5 | Ignore self-engagement; weight reports by distinct, aged accounts | Gaming of Discover; silencing of posts | M | yes | Offline NDCG on a synthetic set (not built yet) |
| 6 | Carry the diversity tail across feed refills | Same destination/creator at page seams | S | yes | Duplicate-exposure metric |
| 7 | Live replan on ETA change (feasibility re-run), traced end to end | A delay does not update the plan | M | yes | Scenario tests: 20/90-min delay, skipped stop |
| 8 | Optimizer benchmark vs nearest-neighbour; duration-advice scenarios | Unproven that the planner beats a naive order | M | yes | Benchmark table; claim only if it wins |
| 9 | Shared rate limiter (DB `consume_quota`) | Per-instance limits are bypassable | M | yes (Postgres) | Limit holds across instances |
| 10 | Playwright mobile-viewport E2E: sign in → plan → drive | No browser tests exist | L | yes | CI green |
