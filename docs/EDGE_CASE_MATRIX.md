# Edge-case matrix (update 52)

Only rows actually examined are listed. Everything else in the brief is `NOT_TESTED`.

Status: `FIXED_AUTOMATED` (was failing, regression test now passes) · `FAIL_CONFIRMED` (open, tracked by `it.fails`) ·
`PASS_AUTOMATED` · `SQL_TEXT_ONLY` (migration text asserted, never executed) · `NOT_TESTED` · `MANUAL_VERIFICATION_REQUIRED`

| Feature | Scenario | Expected | Observed before fix | Status | Sev | Test |
|---|---|---|---|---|---|---|
| Arrival | Parallel road / past the end | not arrived | arrived | FIXED_AUTOMATED | P1 | audit52-navigation |
| ETA refresh | 5xx / 429 | back off | retry on each GPS fix | FIXED_AUTOMATED (source-level check) | P1 | audit52-navigation |
| ETA refresh | Answer after Stop | dropped | route resurrected | FIXED_AUTOMATED (real hook) | P1 | audit52-navigation |
| Live map | Routing down | no fake road | estimate line drawn | FIXED_AUTOMATED (source check) | P2 | audit52-navigation |
| Reroute | Failing provider | exponential backoff | fixed 10 s | fixed; no hook-level test | P2 | coverage gap |
| Off-route | NaN offset | no strike | strike | FIXED_AUTOMATED | P2 | audit52-navigation |
| Geo | Antimeridian | wraps | no wrap | FAIL_CONFIRMED | P3 | it.fails |
| GPS | Jump filters stacked | consistent | disagree for one fix | FAIL_CONFIRMED | P3 | it.fails |
| GPS | Permission revoked / stale / manual pan | handled | handled | PASS_AUTOMATED (code read + existing tests) | — | existing |
| GPS | Real phone, screen lock, background tab | — | — | MANUAL_VERIFICATION_REQUIRED | — | — |
| Trip Check | `driveMin` NaN | "needs drive time" | RangeError | FIXED_AUTOMATED | P2 | audit52-trip |
| Builder | Visit outlasts closing time | warning | "open when you arrive" | FIXED_AUTOMATED | P2 | audit52-trip |
| Hours | `00:00-24:00` | no false close | "closes soon" | FIXED_AUTOMATED | P3 | audit52-trip |
| Hours | Unknown / overnight | unknown is not open | correct | PASS_AUTOMATED | — | audit52-trip |
| Intel engine | Missing route leg | no fake ETA | 0 min of driving | FIXED_AUTOMATED | P2 | audit52-trip |
| Builder | Devanagari duplicates | flagged | silent | FIXED_AUTOMATED | P3 | audit52-trip |
| Freshness | NaN / future timestamp | unverified | fresh | FIXED_AUTOMATED | P3 | audit52-trip |
| Planner | Must-dos exceed capacity | kept, plan infeasible | correct | PASS_AUTOMATED | — | audit52-trip |
| Duration advice, optimizer vs baseline, live replan on ETA change | — | — | — | NOT_TESTED | — | — |
| Weather / terrain / provider timestamps | — | — | read only, no defect found | NOT_TESTED | — | — |
| trip_members | Re-point own row to another trip | blocked | allowed | SQL_TEXT_ONLY (migration unapplied) | P1 | audit52-security |
| follows | Rewrite follower_id | blocked | allowed | SQL_TEXT_ONLY | P2 | audit52-security |
| post_media | Foreign poster_path | blocked | allowed | SQL_TEXT_ONLY | P2 | audit52-security |
| Auth redirect | `/\t/evil.com` | same origin | leaves site | FIXED_AUTOMATED | P2 | audit52-security |
| client-error | `Origin: null` | 403 | throws | FIXED_AUTOMATED | P3 | audit52-security |
| Write routes | Spam | 429 | unlimited | FIXED (per instance only) | P2 | audit52-security (source check) |
| Invites | Expiry / revoke / guessing | enforced | absent | FAIL_CONFIRMED | P2 | it.fails |
| posts | Direct insert with any destination_id | blocked | allowed | FAIL_CONFIRMED | P2 | it.fails |
| Feed | Self-engagement | not counted | counted | FAIL_CONFIRMED | P2 | audit52-feed (documents current behaviour) |
| Feed | Diversity across refill | held | broken at seam | FAIL_CONFIRMED | P2 | audit52-feed (documents current behaviour) |
| Feed | Blocked / hidden leak via cursor or cache | none | none | PASS (code read; RLS not executed) | — | — |
| Group concurrency, account deletion, executed RLS, upload failure midway, accessibility, performance | — | — | — | NOT_TESTED | — | — |
