# TrailMate: context for the next chat

Paste this whole file into a new chat (with the latest zip of the project) so the new chat starts where we left off.
State as of **27 Oct 2026**.

---

## 1. Who I am and how to work with me

- I'm **Bhanu**, founder and developer of TrailMate (repo: github.com/BhanuPrasad404/trip-planner). Hyderabad, India.
- **Windows + PowerShell** on my side. I test inside the **installed PWA** (and Chrome's phone view at 393 × 852).
- **Explain in simple, plain everyday language. Short.** No fancy words.
- **Production grade always:** real root causes, proper error handling, security, scale, tests that FAIL on the old bug.
  No quick hacks unless I ask.
- **Be honest** about what was and wasn't verified. Push back like a senior engineer when something is a bad idea.
- **How code is delivered in chat:** ONE downloadable zip, paths relative to the project root, forward slashes. I apply it with:
  ```
  Expand-Archive -Path "$HOME\Downloads\<name>.zip" -DestinationPath . -Force
  ```
  Database changes: I run `supabase db push`. (When I use **Claude Code** instead, it edits the project directly: no zips.)
- **Before delivering:** typecheck, lint (0 errors), full vitest, `next build`, apply the zip to a clean copy and confirm it
  matches. For database changes also replay every migration + SQL test on a real Postgres with PostGIS (see §8).
- No commit or push without asking. Use theme colours/tokens (never fixed colour values in components). No page wider than the
  phone at 360/390/412 px. Respect reduced motion. Accessible (labels, roles, AA contrast).

## 2. The product

TrailMate is a road-trip planner for Indian travellers (phone first, India time IST +5:30). You describe a trip in your own words
(English, Telugu, Hindi… typed or spoken); it builds an honest, realistic plan on real roads (drive times + margin, no driving
after dark, opening hours, kids/elders limits, night halts in real towns), with three plans (Relaxed / Balanced / Most places),
weather, a live mode and group features. It must feel like a smart local friend, never a form.

**Discover (the feed)** is the social side, built to HELP TRIPS, not to be another Instagram: every post says what a place is
like, when, and how far to trust it, and leads straight into a trip.

## 3. Stack

Next.js **16** (breaking changes: read `node_modules/next/dist/docs` before writing Next code; `proxy.ts` not middleware;
`params` are Promises), React 19, TypeScript, Tailwind 4 (tokens in `app/globals.css`; phones below 768 px use a dark
"forest" theme that remaps `bg-white`, `text-pine` etc.), Supabase (Postgres + RLS + Storage), Vitest (~3,900 tests),
GitHub Actions CI (typecheck + lint + tests + build + database replay). AI: `lib/ai` (Gemini by default).

## 4. Discover / feed: what is built (all tested)

**Round 1: redesign**
- Normal page scrolling (the old nested scroll box with fixed `100dvh - 11.5rem` heights hid buttons behind the bottom bar).
- Cards: header (avatar, destination, @user, badge, Follow chip, ⋯), media, action bar (like, comment, share, "Helpful",
  save), **ground report** (freshness stamp, crowd meter, conditions, tip, "posted from the area"), caption, Add to trip,
  Open map.
- Honesty rules (`lib/feed/ground.ts`): only recent posts are "Current"; old warnings shown calmly, never as alarms.
- Post page `/discover/[id]` (shareable link; media, ground report, "Right now at <place>", comments, more from the place).
- Large screens: side panel with "Right now at <place>" for the post in view.
- Modes: For you / Right now / Planning / My trip / Hidden gems. Trip strip + **custom trip picker** (no browser dropdown).
- Back from a post restores the same posts and scroll spot (`lib/client/feed-snapshot.ts`).
- Sheet fixes: focus no longer jumps while typing, page behind can't scroll, Tab stays inside.

**Round 2: making people post**
- **Badges** (`lib/social/standing.ts`, migration `20261027000000_traveler_standing.sql`): counts DIFFERENT travelers who
  marked a post "helped me decide" or added its place to their trip. One person counts once; never yourself; removed posts stop
  counting. Levels: Helpful traveler 5 · Trusted traveler 25 · Trail guide 100 · Trail legend 500. "Local voice: <place>" at 5
  helped in one place (public posts only). Your own page shows the next goal + progress.
- **Traveler page** `/discover/u/[username]`: badge, posts, travelers helped, followers/following (hidden if they hide follow
  lists), Follow button, their posts (paged, `/api/users/[username]/posts`).
- **Follow on every post** (chip in the card header + on the post page); following someone updates all their posts at once.
- **"How was it?"** after tapping Done on a stop in the Live trip: one-tap crowd/conditions + optional note → a report post.
  Asked once per stop; "Don't ask me after stops" really stops it. (`lib/feed/quick-report.ts`, `components/feed/QuickReport.tsx`)
- **Windowed scrolling**: posts far off screen become empty boxes of the same height (phone stays fast).
- Notifications bell checks every 2 minutes, only while visible.

**Fixes after phone testing**
- **Black/empty videos and photos**: signed picture links expire after 1 hour, and the saved feed kept bringing back old links.
  Now the snapshot remembers when posts were FETCHED (refused after 40 min), and any failing picture asks
  `/api/feed/media` for fresh links once, then shows "couldn't load / Try again" if it really is broken.
- Picture failures are now logged: `[media]` / `[feed] media` in the terminal, `Browser:media` from phones (no secret tokens).

## 5. Key feed files

`components/feed/`: FeedView, FeedCard, PostMedia, FeedVideo, ActionBar, GroundReport, FeedChrome (ModeBar, ShareBox,
TripStrip), TripPicker, ContextPanel, DestinationPulse, PostDetail, MoreFromPlace, PostGrid, TravelerProfile (+ FollowButton),
TravelerBadge, QuickReport, CommentsPanel, Sheet, Toasts.
`lib/feed/` (ground, share, people, aspect, quick-report), `lib/social/standing.ts`, `lib/client/` (use-feed, feed-state,
feed-snapshot, reactions, use-reactions, use-pulse, media-refresh, media-report, scroll-lock, known-position),
`lib/server/` (feed-service: buildFeedPage, loadPost, loadPlaceMore, loadAuthorPosts, loadMedia; standing.ts cache;
discover-context.ts). API: `/api/feed`, `/api/feed/media`, `/api/users/[username]/posts`, `/api/follows`, `/api/posts/*`.

## 6. On hold (my rough order, challenge it if you see better)

1. **Feed "Road ahead"**: a place-first feed ordered along the trip's route (one card per place, posts inside). Not built yet.
2. Smaller images for the feed (needs Supabase image resizing = paid plan: ask me first).
3. Push notifications in the PWA (arrival prompt while the app is closed; "your post helped someone").
4. One shared "does it fit" engine for trip creation (fit meter uses `evaluateBrief`, the plan screen uses `planTrip`; they
   can disagree: the meter lacks road margin, daylight, halts and drive days).
5. City → top sights suggestions; smarter drive days; ask only questions that change THIS trip; measure AI reading on ~50 real
   messages; bus/train honest support; PWA splash.
6. Launch blockers found earlier: the rate limiter is per server instance (needs a shared one before public launch: the guest
   voice route calls Gemini); three "OPEN P2" security tests (`tests/audit52-security.test.ts`).

## 7. Not verified yet (be careful)

- Feed screens seen only in headless Chrome screenshots + my PWA testing; swipe/video/share on many real phones not yet.
- Badges need real users to mean anything; the database part is tested on a real Postgres.
- Node 20 warning from supabase-js: upgrade to Node 22 when convenient.

## 8. How to verify (sandbox notes for the assistant)

- `npx tsc --noEmit` · `npx eslint .` · `npx vitest run` · build with
  `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-key npx next build`
- Database: install `postgresql-16 postgresql-16-postgis-3`, start it, then
  `PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/db-replay.sh` (replays every migration + SQL tests).
  A SQL test acting as "the system" must clear `request.jwt.claim.sub` first (posts' trigger blocks signed-in status changes).
- Phone width: `CHROME_NO_SANDBOX=1 CHROME_PATH=<playwright chromium> npx vitest run tests/phone-width.test.ts`
  (needs a fresh `next build` for the CSS).
- The sandbox shell is `/bin/sh` (no brace expansion).
