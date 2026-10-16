# Trailmate — Start here (status, setup and testing)

Written 16 Oct 2026, after tasks 1–11. Simple words, step by step. **There are no secret keys or passwords in this file.**
Anything I could not check myself is marked **NOT VERIFIED**.

---

## Start here: the 5 most important things to do first

1. **Save the work in git.** Nothing from tasks 1–11 is committed yet. In VS Code's terminal:
   `git add -A` then `git commit -m "Tasks 1-11: password reset, delete trip, members, invites, PWA, offline, Google login, stops, km, season data, landing example"`
   (then `git push` if you use GitHub).
2. **Apply the new database changes** (section 5). At least 3 new migrations are not on your live database yet:
   `20261022000000_leave_and_remove_members.sql`, `20261023000000_invite_rotation_expiry.sql`, `20261023000001_season_data.sql`.
3. **Fix the Supabase login settings** (section 3, steps A–C): Site URL, Redirect URLs, and the "Reset Password" email template.
   Without these, password reset and Google login send people to the wrong place.
4. **Set up a real email sender (SMTP)** (section 3, step D). Supabase's built-in email is only for testing. Without SMTP, most
   people will never get the reset email.
5. **Test on your phone through an https address** (section 7). A phone cannot use GPS on a plain `http://` address, so use a
   Vercel preview link.

---

## 1. What is DONE (tasks 1 to 11)

How each one was checked:
- "tested by automatic tests" = Vitest tests on this PC (`npm run check`);
- "SQL test" = run on a real Postgres + PostGIS database in Docker;
- "checked on a real device" = tried on a real phone or browser. **No task has been checked on a real phone yet.**

### Task 1 — Password reset — DONE
- **What you see now:** a "Forgot password?" link under the password box on the login page. You type your email and always get
  the same message: "If an account exists for this email, we've sent a link…". It never says whether the email exists. The
  "Send" button waits 60 seconds before you can send again. The email link opens "Set a new password" (twice, at least
  8 characters). After saving, your other logged-in devices are logged out. An old or used link says "This reset link has
  expired…" with a button to get a new one.
- **Files:** `lib/password-reset.ts`, `components/ForgotPasswordForm.tsx`, `components/ResetPasswordForm.tsx`,
  `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/auth/confirm/route.ts`, `app/auth/callback/route.ts`,
  `components/AuthForm.tsx`, `lib/supabase/proxy.ts`, `tests/password-reset.test.tsx`.
- **Checked:** tested by automatic tests. Sending a real email: **NOT checked**.

### Task 2 — Delete trip — DONE
- **What you see now:** at the bottom of the trip overview, only the owner sees "Delete this trip". A box explains what is
  removed (stops, votes, members, live locations, trip photos, for everyone), and you must type the trip name. After deleting
  you go to "My trips" with "Trip deleted". Anyone else who has the trip open (even while driving) sees "This trip was deleted
  by the owner", and their GPS sharing stops. "Finish" and "Call it off" are unchanged.
- **Files:** `app/api/trips/[id]/route.ts`, `lib/server/trip-delete.ts`, `lib/trip/deletion.ts`, `components/DeleteTripButton.tsx`,
  `components/TripGoneWatcher.tsx`, `app/(app)/trips/[id]/page.tsx`, `app/(app)/trips/[id]/layout.tsx`, `app/(app)/trips/page.tsx`,
  `lib/client/use-drive.ts`, `lib/validation/schemas.ts`, `supabase/tests/trip_delete.test.sql`, `tests/trip-delete.test.tsx`.
- **Checked:** tested by automatic tests and the SQL test. Two phones live: **NOT checked**.

### Task 3 — Leave trip / remove member — DONE (needs migration `20261022000000`)
- **What you see now:** a "Members" box on the trip overview.
  - A member can **Leave trip**.
  - The owner can **Remove** someone, or **Make owner** (hand the trip over).
  - The owner cannot just leave: the box explains "hand it over or delete the trip".
  - The removed person sees "You were removed from this trip".
  - What happens to the person's things in that trip: live location, votes and pings are deleted; **the stops they added stay**
    with the group, without their name.
- **Files:** `supabase/migrations/20261022000000_leave_and_remove_members.sql`, `lib/server/trip-members.ts`,
  `app/api/trips/[id]/members/[userId]/route.ts`, `app/api/trips/[id]/owner/route.ts`, `components/MembersPanel.tsx`,
  `components/TripGoneWatcher.tsx`, `supabase/tests/trip_members_leave.test.sql`, `tests/trip-members.test.tsx`.
- **Checked:** tested by automatic tests and the SQL test (who may remove whom). Live: **NOT checked**.

### Task 4 — Invite link rotation and expiry — DONE (needs migration `20261023000000`)
- **What you see now:**
  - The owner has a "New invite link" button. **The old link stops working at once.**
  - The new link can be set to never expire, or to work for 24 hours, 7 days or 30 days.
  - Everyone sees "Expires …" or "Never expires".
  - After 10 wrong invite codes in an hour, joining is paused for that person for an hour.
  - The join page says clearly: link replaced, expired, or too many attempts.
- **Files:** `supabase/migrations/20261023000000_invite_rotation_expiry.sql`, `lib/server/invites.ts`,
  `app/api/trips/[id]/invite/route.ts`, `app/join/[code]/page.tsx`, `components/InvitePanel.tsx`, `lib/types/index.ts`,
  `supabase/tests/invite_rotation.test.sql`, `tests/invites.test.tsx`.
- **Checked:** tested by automatic tests and the SQL test. A real WhatsApp link: **NOT checked**.

### Task 5 — PWA (install as an app) — DONE
- **What you see now:** the phone can offer "Install app" / "Add to Home Screen", with the Trailmate icon. The installed app opens
  without the browser bar. Everyone now gets the friendly offline page when there is no signal. **Nothing private is ever stored**
  by the service worker: only the offline page.
- **Files:** `app/manifest.ts`, `app/pwa-icon/[size]/route.tsx`, `app/apple-icon.tsx`, `lib/pwa.tsx`, `components/shell/ServiceWorker.tsx`,
  `components/shell/AppShell.tsx`, `app/layout.tsx`, `proxy.ts`, `lib/client/alert-channels.ts`, `tests/pwa.test.tsx`.
- **Checked:** tested by automatic tests. The manifest and icons were also fetched from a real production server (`next start`)
  on this PC. Installing on a real phone: **NOT checked**.

### Task 6 — Offline queue for more actions — DONE
- **What you see now:** with no signal you can still do these, and you see "Saved on your phone — will send when online":
  - mark visited / skipped;
  - vote;
  - move a stop to another day;
  - fix a pin;
  - post a community update with text and tags.

  A strip shows "2 changes are saved on your phone…", then "All waiting changes were sent".
  - **Not saved offline** (a clear message instead): photos, deleting a stop, re-plan / Auto-plan.
  - **Privacy fix:** waiting changes now belong to ONE person. On a shared phone the next person never sees or sends them.
  - Signing out with waiting changes asks you first.
- **Files:** `lib/client/outbox.ts`, `lib/client/use-outbox.ts`, `lib/client/use-visits.ts`, `lib/client/use-local-json.ts` (bug fix),
  `lib/client/use-trip-actions.ts`, `components/OutboxStatus.tsx`, `components/SignOutForm.tsx`, `components/TripPlanner.tsx`,
  `components/LiveView.tsx`, `components/MapView.tsx`, `components/StopCard.tsx`, `components/PlaceReports.tsx`,
  `components/shell/AppNav.tsx`, `components/SiteHeader.tsx`, `app/(app)/profile/page.tsx`, `tests/outbox.test.tsx`.
- **Checked:** tested by automatic tests. Airplane mode on a real phone: **NOT checked**.

### Task 7 — Google login — DONE (needs your Google + Supabase setup, section 3 step E)
- **What you see now:** "Continue with Google" on the login and sign-up pages. The first time, a one-time "One more step" page
  asks for your name (filled in from Google) and the 18+ / Terms tick, exactly like email sign-up. Email accounts are not affected.
- **Files:** `lib/oauth.ts`, `components/GoogleButton.tsx`, `app/welcome/page.tsx`, `components/WelcomeForm.tsx`,
  `components/AuthForm.tsx`, `app/auth/callback/route.ts`, `lib/supabase/proxy.ts`, `tests/google-login.test.tsx`.
- **Checked:** tested by automatic tests. A real Google sign-in: **NOT checked** (it needs your Google client).

### Task 8 — Deleted stop → go to the next stop — DONE
- **What you see now:**
  - If the stop you are driving to is deleted (by you or another member), the app goes to the next remaining stop at once and
    says "A stop was removed. Going to … now."
  - If it was the last stop: "No more stops today".
  - Done and skipped stops are never the target.
  - No "you've arrived" card for a deleted stop.
  - Other members' screens hear about the change at once.
  - Old road distances through a deleted stop are never shown again.
- **Files:** `lib/trip/stop-change.ts`, `lib/client/use-stop-removed.ts`, `lib/client/use-trip-changes.ts`, `lib/client/stop-signal.ts`,
  `lib/client/use-drive.ts`, `lib/client/use-trip-live.ts`, `lib/client/use-arrival.ts`, `lib/client/use-nav-ui.ts`,
  `components/map/NavigationOverlay.tsx`, `components/LiveView.tsx`, `components/MapView.tsx`, `components/TripPlanner.tsx`,
  `lib/client/use-trip-actions.ts`, `app/api/places/[id]/route.ts`, `tests/stop-removed.test.tsx`, `tests/stop-removed-km.test.tsx`.
- **Checked:** tested by automatic tests (the bug was reproduced first, then fixed). Real driving: **NOT checked**.

### Task 9 — Season data — DONE (needs migration `20261023000001`)
- **What you see now:** 29 places (was 19).
  - 10 new ones, approved by you: Laknavaram Lake, Pakhal Lake, Bhadrachalam Temple, Yadagirigutta Temple, Nagarjuna Sagar Dam
    (**Draft**), Ananthagiri Hills, Bhongir Fort, Mallela Theertham Waterfall, Srisailam Temple, Tirumala Temple.
  - RK Beach Visakhapatnam is now **Draft** (only 1 source).
  - `npm run build:season` now writes a NEW migration and never rewrites an old one.
  - The checks now require 2+ different websites for "researched".
- **Files:** `data/season-tags.json`, `data/season-research/batch-02.json` (the evidence: quotes and links),
  `scripts/build-season-migration.mjs`, `scripts/season-sql.mjs`, `scripts/season-sql.d.mts`,
  `supabase/migrations/20261023000001_season_data.sql`, `tests/season-data.test.ts`.
- **Checked:** tested by automatic tests and the SQL test. Every quote came from a fetched web page and 3 were re-checked by hand.
  The sources are mostly travel websites, not official ones. **NOT VERIFIED** by a person on the ground.

### Task 10 — Correct km from my real GPS position — DONE
- **What you see now:**
  - Every screen (Drive panel, Live card, progress bar, arrival card, map) shows the SAME distance, measured from where you
    really are, through the remaining stops only.
  - A few metres show as "20 m", not "0.0 km". Long distances show as "1,299 km".
  - With weak or old GPS it says "about 25 km · GPS is weak".
  - If the routing service fails it says "(estimated)".
- **Files:** `lib/trip/remaining.ts`, `lib/client/use-trip-live.ts`, `lib/client/use-drive.ts`, `lib/map/journey.ts`,
  `components/DrivePanel.tsx`, `components/LiveView.tsx`, `components/TripProgress.tsx`, `components/ArrivalCard.tsx`,
  `components/LiveArrival.tsx`, `components/map/NavigationOverlay.tsx`, `tests/remaining-km.test.ts`,
  `tests/remaining-screens.render.test.tsx`, `tests/intel-engine.test.ts`.
- **Checked:** tested by automatic tests (failing first, then fixed). Compared with Google Maps on a real drive: **NOT checked**.

### Task 11 — Landing page sample trip — DONE
- **What you see now:** the landing page example is a REAL 2-day route from our season data: Hyderabad → Warangal Fort →
  Thousand Pillar Temple → Ramappa Temple → Bogatha Waterfall. A switch "If you go in: August | December" shows that WHEN matters:
  - in **August** the waterfall is in season and the fort and temples are not;
  - in **December** it is the other way round.

  Every badge and sentence comes from `data/season-tags.json`. There are no invented times, km or scores. It is labelled
  "Example route", with a note that your own trip uses your dates, live weather and real driving times.
- **Files:** `lib/landing-sample.ts`, `components/LandingSample.tsx`, `app/page.tsx`, `tests/landing-sample.test.tsx`, `HANDOFF.md`.
- **Checked:** tested by automatic tests. They check all 12 months against the data, and that removing a place makes the test
  fail instead of showing a made-up stop. Look in a real browser or phone: **NOT checked**.

**Whole project today:** `npm run check` = typecheck OK, lint 0 errors (4 old warnings), **196 test files, 3,075 tests passed**.
`next build` = OK. All 11 SQL test files pass on Postgres 16 + PostGIS in Docker.

---

## 2. NOT DONE or only partly done

| What | Why |
|---|---|
| Old 8-character invite codes (trips made before 6 Oct) | Changing them would break links already shared on WhatsApp. Press "New invite link" on those trips yourself. |
| Offline: photos, deleting, re-plan, opening hours, priority | Too big or risky to keep on the phone, or they need the server. A clear message is shown instead. |
| A community update can rarely be posted twice | Only if the reply is lost after it was saved. Fixing it needs a small database change. Ask if you want it. |
| Drive mode when the screen is locked | Browsers stop GPS when the screen is off. That needs a native app. |
| Season data from official sources | The Telangana Tourism website would not load during research. Most sources are travel sites. |
| Nothing checked on a real phone | I have no phone. Use section 7. |
| Live database status of migrations | I cannot see your live database. Check it with section 5. |

---

## 3. THINGS YOU MUST SET UP YOURSELF (in this order)

> Your Supabase project id is `hdknhvrfnyfcctxbzuax`. Replace `<your-domain>` with your real site address once it is deployed
> (for example the Vercel address `https://<project>.vercel.app`).

### A. Supabase → Site URL and Redirect URLs
- **Open:** https://supabase.com/dashboard → your project → **Authentication** → **URL Configuration**.
- **Paste:**
  - **Site URL:** `http://localhost:3000` now. Change it to `https://<your-domain>` after you deploy.
  - **Redirect URLs** → **Add URL**: `http://localhost:3000/**`, then also `https://<your-domain>/**` after deploying.
  - Press **Save**.
- **How you know it worked:** after a password reset or Google login you land back on Trailmate, not on an error page.
- **If you skip it:** reset links and Google login send people to the wrong address or show "redirect not allowed".

### B. Supabase → "Reset Password" email template
- **Open:** **Authentication** → **Emails** (Email Templates) → **Reset Password**.
- **Paste** this as the message body:
  ```html
  <h2>Reset your Trailmate password</h2>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Set a new password</a></p>
  <p>If you didn't ask for this, you can ignore this email.</p>
  ```
  Press **Save**.
- **How you know it worked:** ask for a reset on your laptop, open the email on your PHONE, tap the link → "Set a new password" opens.
- **If you skip it:** the link only works in the same browser that asked for it. Opening it on another device says "expired".

### C. Supabase → "Confirm signup" email (optional but good)
- **Open:** the same Emails page → **Confirm signup**. You can leave the default.
- If you want it to work across devices too, use:
  `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/trips">Confirm your email</a>`
- **NOT VERIFIED** on your project.

### D. Custom email sender (SMTP)
- **First:** create a free account with an email-sending service, for example Brevo, Resend or Zoho Mail. Add and verify your
  domain there; they show you DNS records to add.
- **Open:** Supabase → **Authentication** → **Emails** → **SMTP Settings** → switch on **Enable Custom SMTP**.
- **Paste** (from your email service's "SMTP" page):
  - **Sender email:** for example `no-reply@<your-domain>`;
  - **Sender name:** `Trailmate`;
  - **Host**, **Port** (usually 587 or 465), **Username**, **Password** (the SMTP password, NOT your login password).
  - Press **Save**.
- **How you know it worked:** ask for a password reset with a friend's email (not yours). It arrives within a minute, from `Trailmate`.
- **If you skip it:** Supabase's built-in sender is for testing only. It sends very few emails per hour, and may only deliver
  to your own team's addresses (**NOT VERIFIED** for your plan). Most users would never get reset or confirmation emails.

### E. Google login
**E1. Google Cloud Console** — https://console.cloud.google.com
1. At the top, **select or create a project**, for example "Trailmate".
2. Menu → **Google Auth Platform** (older screens: "APIs & Services → OAuth consent screen") → **Get started**:
   - App name `Trailmate`, your support email, Audience **External**, your contact email → **Create**.
3. **Branding:**
   - under **Authorised domains** add `supabase.co`, and later your own domain;
   - after deploying, add the Home page, `https://<your-domain>/privacy` and `https://<your-domain>/terms`.
4. **Data access** → **Add or remove scopes** → tick `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` → **Save**.
5. **Audience:** while testing, add your friends' Gmail addresses under **Test users**. Before real users: **Publish app**.
6. **Clients** → **Create client** → type **Web application**, name `Trailmate web`:
   - **Authorised JavaScript origins:** `http://localhost:3000`, and later `https://<your-domain>`;
   - **Authorised redirect URIs:** exactly `https://hdknhvrfnyfcctxbzuax.supabase.co/auth/v1/callback`
   - → **Create**. Copy the **Client ID** and **Client secret**. Keep the secret private.

**E2. Supabase**
- **Authentication** → **Sign In / Providers** → **Google** → switch it on → paste the Client ID and Client secret → **Save**.

- **How you know it worked:** on the login page tap "Continue with Google" → choose your account → the "One more step" page →
  tick → your trips.
- **If you skip it:** the button shows "Google sign-in isn't switched on yet…". Email login still works.

### F. Supabase → Realtime (for "trip deleted", "you were removed", "stop removed" messages)
- **Open:** Supabase → **Realtime** → **Settings**. Make sure **"Allow public access"** is ON, or "private channels only" is OFF.
  The exact wording may differ (**NOT VERIFIED**).
- **How you know it worked:** two phones on one trip; delete a stop on one, and the other shows "A stop was removed…" within seconds.
- **If you skip it / it is off:** the messages still appear, but only when the screen comes back on, or after up to 1–2 minutes.

### G. Environment variables on your server (Vercel)
- **Open:** https://vercel.com → your project → **Settings** → **Environment Variables**.
- **Paste:** add the variables from section 4 (at least the "required" ones) for **Production** and **Preview** → then
  **Deployments** → **Redeploy**.
- **How you know it worked:** in the app, **Profile → Setup check** shows the keys as found.
- **If you skip it:** see the table in section 4.

### H. After you deploy (your real address)
- Add `https://<your-domain>` to: Supabase **Site URL** + **Redirect URLs** (step A), and Google **Authorised JavaScript origins** (step E1-6).
- Set `NEXT_PUBLIC_SITE_URL=https://<your-domain>` in Vercel (step G).

---

## 4. THE .env FILE (names only, never values)

Local file: `.env.local` (never commit it). On Vercel: **Settings → Environment Variables**. After changing `.env.local`,
stop and restart `npm run dev`.

| Name | What it is for | Where to get it | Required? | In your `.env.local` now |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your database and login server | Supabase → Project Settings → API → Project URL | **Required** | set |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key for the app | Supabase → Project Settings → API → anon / publishable key | **Required** | set |
| `NEXT_PUBLIC_SITE_URL` | Your real web address (emails, SEO, invite links) | Your Vercel/domain address | **Required in production** (local works without it) | not set |
| `GEOCODER_USER_AGENT` | Contact for OpenStreetMap search and Wikimedia photos | Your email or site | **Required** (search and photos get blocked without it) | set |
| `SUPABASE_SERVICE_ROLE_KEY` | SERVER-ONLY secret: places database, removing trip photos when a trip is deleted | Supabase → Project Settings → API → service_role | Strongly recommended | not set |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | AI import and Trip Brief (one of them) | console.anthropic.com / aistudio.google.com / your provider | Optional (Maps-link import works without) | Gemini set |
| `AI_PROVIDER`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | Pick the AI provider and model | — | Optional | AI_PROVIDER, GEMINI_MODEL set |
| `IMPORT_DAILY_LIMIT` | AI imports per person per day | You choose a number | Optional | not set |
| `GEOCODE_DAILY_LIMIT` | Place searches per person per day | You choose a number | Optional | not set |
| `INGEST_SECRET` | Lets you pre-load a region of places (`scripts/ingest-region.mjs`) and test alerts | Any random text, 16+ characters | Optional | not set |
| `ALERT_WEBHOOK_URL` | Sends errors to your Discord channel | Discord → channel → Integrations → Webhooks | Recommended before real users | not set |
| `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_LEGAL_ADDRESS` | Who runs the service, shown on /privacy and /terms | You | **Required before real users** | not set |
| `OSRM_BASE_URL` | Your own road-routing server | Self-hosted or paid OSRM | Optional (the free demo is used) | not set |
| `NEXT_PUBLIC_MAP_STYLE_URL` | Map style | MapTiler, Stadia or self-hosted | Optional | not set |
| `NEXT_PUBLIC_SATELLITE_TILES_URL` | Satellite layer you are licensed to use | Your tile provider | Optional | not set |
| `OVERPASS_URL` | Your own places server (OpenStreetMap) | Self-hosted Overpass | Optional | not set |
| `PLACE_PHOTOS_UPSTREAM` | Set to `off` to stop all Wikimedia photo calls | — | Optional | not set |
| `ROUTING_PROVIDER`, `PLACES_PROVIDER`, `WEATHER_PROVIDER`, `GEOCODING_PROVIDER` | Switch a provider without code changes | — | Optional | not set |

**No new variables were added in tasks 1–10.** The Google secret lives only in Supabase, not in `.env`.

---

## 5. DATABASE: migrations

All 26 files are in `supabase/migrations/` and run in this order:

1. `20260804000000_init_schema.sql`
2. `20261006000000_security_hardening_and_invites.sql`
3. `20261006120000_import_scoring_and_limits.sql`
4. `20261007000000_destination_address_votes.sql`
5. `20261008000000_season_evidence_and_feedback.sql`
6. `20261008000100_season_data_andhra_telangana.sql`
7. `20261009000000_stop_progress.sql`
8. `20261009000100_place_reports.sql`
9. `20261009000200_report_photos_bucket.sql`
10. `20261009000300_live_locations.sql`
11. `20261010000000_poi_store_and_trip_prefs.sql`
12. `20261011000000_social_foundation.sql`
13. `20261011000100_post_media_bucket.sql`
14. `20261012000000_place_priority.sql`
15. `20261013000000_destination_feed.sql`
16. `20261014000000_engagement_social.sql`
17. `20261015000000_travel_intelligence.sql`
18. `20261016000000_account_deletion.sql`
19. `20261017000000_audit52_hardening.sql`
20. `20261018000000_place_opening_hours.sql`
21. `20261019000000_place_photo_cache.sql`
22. `20261020000000_explore_cache_saved_places.sql`
23. `20261021000000_trip_lifecycle.sql`
24. `20261022000000_leave_and_remove_members.sql` — **NEW (Task 3), NOT applied**
25. `20261023000000_invite_rotation_expiry.sql` — **NEW (Task 4), NOT applied**
26. `20261023000001_season_data.sql` — **NEW (Task 9), NOT applied**

**Which are applied on the live database?**
- 1–6 were confirmed applied on 7 Oct (HANDOFF.md).
- 7–23: **NOT VERIFIED**. Earlier notes say some were "pending", for example `20261021000000_trip_lifecycle.sql`.
- 24–26: **certainly NOT applied** (made in this session).

**How to check and apply** (PowerShell, in the project folder). Type the password hidden; never paste it in chat:
```powershell
$s = Read-Host "Database password" -AsSecureString
$pw = [uri]::EscapeDataString([System.Net.NetworkCredential]::new("", $s).Password)
$db = "postgresql://postgres.hdknhvrfnyfcctxbzuax:$pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"

npx supabase migration list --db-url $db      # shows Local vs Remote: anything with no Remote value is NOT applied
npx supabase db push --db-url $db --dry-run   # lists exactly what WOULD be applied — read it first
npx supabase db push --db-url $db             # applies them, in order
```
- **How you know it worked:** run `migration list` again, and every file has a Remote value.
- If you get `SQLSTATE 28P01`, the password is wrong. Reset it in Supabase → Project Settings → Database.
- **Season data in future:** edit `data/season-tags.json` → `npm run build:season` → `npm run check` → `db push`.

---

## 6. HOW TO RUN

Node 20 works (Node 22 recommended later). In the VS Code terminal, in the project folder:

| What | Command |
|---|---|
| Install | `npm install` (if it fails with `edgesOut`: `npm cache clean --force` then `npm install --legacy-peer-deps`) |
| Start (development) | `npm run dev` → open http://localhost:3000 |
| All checks (types + lint + tests) | `npm run check` |
| Production build | `npx next build` then `npx next start` |
| SQL tests (needs Docker Desktop running) | `docker run -d --name tm-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgis/postgis:16-3.4`, then copy and run `scripts/db-replay.sh` inside it (GitHub CI does this for you on every push) |
| Season data → migration | `npm run build:season` |

**A healthy start looks like:**
- `npm run dev` prints `[maplibre] copied 2 worker files`, then `Ready in …`;
- http://localhost:3000 shows the landing page, and login works;
- `npm run check` ends with `Test Files 196 passed` and `0 errors` (the 4 old lint warnings are fine);
- `npx next build` ends with the list of pages and no "Error".

---

## 7. HOW TO TEST ON A PHONE

**First, get an https address.** A phone cannot use GPS on `http://192.168…`. The easy way: push your branch to GitHub, and
Vercel makes a **Preview** link `https://…vercel.app`. Add that address to Supabase Redirect URLs (section 3 A) and to Google
origins (E1-6).
Use **two accounts** (yours and a friend's, or a second Gmail) and ideally **two phones**.

1. **Password reset (Task 1)**
   - Login → "Forgot password?" → your email → Send.
   - Open the email on the phone → "Set a new password" → save → you are in.
   - Tap the same link again → "expired".
   - Try an email that has no account → the same "If an account exists…" message.
2. **Google login (Task 7)**
   - "Continue with Google" → pick an account → "One more step" → tick → your trips.
   - Sign out and in again → no "One more step" this time.
3. **Invite link (Task 4)**
   - Owner: Trip overview → "New invite link" → 24 hours → send it to the friend → the friend joins.
   - Make another new link → the friend opens the OLD link on a third account → "replaced or mistyped".
4. **Leave / remove (Task 3)**
   - Friend: Members → Leave trip → back at "My trips" with "You left the trip".
   - Owner: Remove the friend while their phone shows the trip → their phone shows "You were removed from this trip".
   - Owner: Leave trip → the "hand it over or delete" box appears.
5. **Deleted stop while driving (Task 8)**
   - Trip with 3 stops today → Live → Start drive.
   - The friend deletes stop 1 on their phone → your phone says "A stop was removed. Going to <stop 2> now." and the route changes.
   - Delete the rest → "No more stops today".
6. **Correct km (Task 10)**
   - While driving, compare "km to next stop" with Google Maps from the same place. A few km difference can be normal
     (different roads).
   - Go indoors (weak GPS) → you should see "about … · GPS is weak".
7. **Offline (Task 6)**
   - Airplane mode ON → mark a stop visited, vote, post an update without a photo → each says "Saved on your phone".
   - Try a photo → "Photos need a connection".
   - Airplane mode OFF → within about 20 seconds "All waiting changes were sent".
   - Sign out while something waits → the warning appears.
8. **Delete trip (Task 2)**
   - Owner: Delete this trip → type the name → "Trip deleted".
   - The friend who had it open sees "This trip was deleted by the owner".
9. **Install app (Task 5)**
   - Android Chrome: menu → **Install app**. iPhone Safari: Share → **Add to Home Screen**.
   - The icon and name are right, and it opens without the browser bar.
   - Airplane mode → open a page → the Trailmate offline page.
10. **Season data (Task 9)**
    - Add "Bhongir Fort" to a trip dated in May → "wrong season". Change the date to December → "good season".
    - Nagarjuna Sagar shows "Draft".

Write down what went wrong (a screenshot helps). That is the most useful next input.

---

## 8. KNOWN RISKS before real users

**Fix first**
1. **Email (SMTP) not set up** → resets and confirmations don't arrive. (Section 3 D.)
2. **Migrations not applied** → Members, invites and season data say "needs a database update". (Section 5.)
3. **Free public services** can slow down or block you when traffic grows:
   - OSRM demo (routing);
   - Nominatim (search, about 1 request per second);
   - Overpass (nearby places);
   - OpenFreeMap / OSM tiles (maps);
   - Open-Meteo (weather);
   - Wikimedia (photos).

   Plan paid or self-hosted versions before launch (`OSRM_BASE_URL`, `OVERPASS_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`).
4. **Legal names empty** (`NEXT_PUBLIC_LEGAL_*`) → the Privacy and Terms pages don't say who runs the service.
5. **`SUPABASE_SERVICE_ROLE_KEY` missing** → the places database is kept in memory only.

**Security and privacy**
- Old 8-character invite codes on trips made before 6 Oct are weaker. Press "New invite link" on them.
- Some request limits are kept in server memory. On Vercel each server copy counts separately, so the limit is softer than it
  looks. The daily quotas are in the database and are strict.
- There is no Content-Security-Policy header yet.
- The "something changed" signals (Realtime broadcast) are hints only. Every screen re-checks the database, so a fake signal
  cannot show anyone's data.
- Error alerts only go to Discord if `ALERT_WEBHOOK_URL` is set. There is no other monitoring yet.

**Limits**
- Supabase Free plan limits: database size, monthly users, the project pausing after a week of no use. Check the current
  numbers on supabase.com/pricing (**NOT VERIFIED**).
- GPS stops when the phone screen is locked (browser limit).
- An iPhone home-screen app keeps its own login, separate from Safari.
- Season data is from travel websites, not official sources, and covers 29 places in AP and Telangana only.

---

## 9. NEXT STEPS (in order)

1. Commit and push the work (Start here, step 1).
2. Apply migrations 24–26 (and any others "not applied") — section 5.
3. Supabase URL settings, the reset email template and SMTP — section 3 A, B, D.
4. Google login setup — section 3 E.
5. Vercel: environment variables, deploy, then add the real address everywhere — section 3 G and H.
6. Phone tests with a friend — section 7. Send me the results and screenshots.
7. Fix what the phone tests find.
8. Season data: research places 11–20 (same process as Task 9).
9. Before real users: paid or self-hosted map, routing and search services; legal names; Discord alerts; a Content-Security-Policy.
