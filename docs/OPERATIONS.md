# Running Trailmate with real people (free plan)

Plain-English guide. Every step says where to click.

## 1. Alerts: be told when something breaks (free)

What happens: when the server or someone's browser hits an unexpected error, a short message is posted to a chat channel on your
phone. The same error is sent at most once every 10 minutes and at most 20 times an hour. Emails, passwords and tokens are removed
before anything is sent. Errors are also always written to Vercel's logs.

Set up (5 minutes):
1. Install Discord (free). Create a server called "Trailmate alerts". Create a channel called `errors`.
2. Channel settings (gear icon) → Integrations → Webhooks → New Webhook → **Copy Webhook URL**.
3. Vercel → your project → Settings → Environment Variables → add `ALERT_WEBHOOK_URL` = that URL (Production **and** Preview). Redeploy.
4. Test it (needs `INGEST_SECRET` to be set, 16+ characters). In PowerShell, from any folder:
   ```
   Invoke-RestMethod -Method Post -Uri "https://YOUR-SITE.vercel.app/api/admin/alert-test" -Headers @{ "x-ingest-secret" = "YOUR_INGEST_SECRET" }
   ```
   A "TestAlert" message should appear in Discord within a few seconds. If you get `ALERT_WEBHOOK_URL is not set`, the variable did not
   reach the deployment (redeploy after adding it).

Not covered: a site that is completely down (nothing runs to send the message), and a Supabase project that was paused. Use a free
uptime checker (for example UptimeRobot, 5-minute checks on your home page) for that.

## 2. CI: "checks on every push" in one paragraph

Today you run `npm run check` by hand. CI means GitHub does it for you, automatically, every time you push: a clean computer in the
cloud installs the project, runs typecheck, lint, all tests and a production build, and also rebuilds the database from every
migration and runs the SQL tests. You see a green tick or a red cross next to the commit on GitHub. It matters because "it worked on my
laptop" is the most common reason a broken version reaches users. The file is `.github/workflows/ci.yml`; it works as soon as it is on GitHub
(Repository → Actions tab). It uses no secrets.

## 3. "Separate test site and live site" explained

Right now there is ONE of everything: one Vercel project and one Supabase project. So when you test a risky change or a delete-account
button, you are testing on the same database your real users are in.

- **Vercel already makes a separate test copy for free**: every branch you push (anything other than `main`) gets its own web address
  ("Preview deployment"). But if that preview talks to the same Supabase, it still touches real data.
- **A separate Supabase project for testing is free**: the Free plan allows **2 active projects**. Create `trailmate-test`, run the migrations
  on it (`npx supabase link --project-ref <test-ref>` then `npx supabase db push`), and in Vercel set the Supabase variables for **Preview**
  to the test project and keep **Production** on the live one (Vercel lets each variable have different values per environment).
- You do NOT need this to start a 50-100 person test. You DO need it before you test anything destructive (delete account, big
  migrations) on a system that holds other people's trips. Until then: test those on your own throw-away account only.

## 4. What the Supabase Free plan means for a 50-100 person test (as listed on supabase.com/pricing)

| Limit | Free plan | What it means for you |
|---|---|---|
| Database | 500 MB per project | Plenty for text data of 100 people |
| File storage | **1 GB** | The tight one. Videos are up to 30 s / 50 MB: about 20-25 full-size videos fill it. Watch Dashboard → Storage. |
| Users | 50,000 monthly active | Not a concern |
| **Pausing** | **Paused after 1 week of inactivity** | A quiet week switches the whole app off until you press "Restore". Keep it alive (a free uptime checker pinging the site counts as activity) |
| **Backups** | **Not included** | If data is lost it is gone. Download a backup by hand now and then (Supabase Dashboard → Database → Backups is Pro only; use `npx supabase db dump`) |
| Max upload | 50 MB per file | Matches the app's video limit |

The free public map, route and search services (OSRM, Nominatim, Overpass, Open-Meteo, OpenFreeMap) have no guarantee and fair-use limits.
For 50-100 testers they are fine; watch the alerts for "Routing service" errors.

## 5. Delete my account / Download my data

- Profile → **Download my data** gives one JSON file (3 per hour). Profile → **Delete my account** needs the email and password, removes
  uploaded files first, then runs the database function. A trip you own that others are on is handed to the member who joined first.
- **One-time step**: the database function must exist. Apply the migration `20261016000000_account_deletion.sql`
  (`npx supabase db push --dry-run` first, then `npx supabase db push`). Until then the button answers: "Account deletion isn't switched on yet".
- To test on a throw-away account: sign up with a second email, create a trip, upload a photo, then delete. Check Supabase → Authentication → Users
  (the user is gone) and Storage (its folder is empty).

## 6. Legal pages

`/privacy` and `/terms` are live. Set these in Vercel (Production and Preview) so the pages say who runs the service:
`NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL` (and optionally `NEXT_PUBLIC_LEGAL_ADDRESS`). The text was written from what the app
really does, in plain language. It is **not legal advice**: have a lawyer who knows Indian law (DPDP Act 2023, IT Act) read it before you invite
people you do not know. If the app changes what it collects or which services it uses, update `lib/legal-content.ts` (a test fails if a known
service or data type is missing).
