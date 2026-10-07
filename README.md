# Trailmate

Season-aware group trip planner. Add places (by hand or from reel links), see which ones are
**out of season for the day you'll actually be there**, auto-order stops so the route makes sense,
and share one plan with your group via an invite link.

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · Supabase (Auth + Postgres + RLS) · Zod · Vitest

## Features

- Email/password auth with confirmation, protected routes, safe `?next=` redirects
- Trips dashboard + trip creation
- Season check per stop, evaluated against the **visit date** (trip start date + day number)
- **Auto-plan route:** nearest-neighbour ordering + time-on-ground day splitting (`lib/geo.ts`)
- Invite links (`/join/<code>`) with one-tap WhatsApp share; copy/send the whole itinerary as a WhatsApp-ready message
- Smart import (Maps links, pasted text, screenshots) and "Describe my trip" AI suggestions — always reviewed before saving
- Go Score per stop (season + forecast/6-year weather), real driving times in Auto-plan, live map
- Place search with a trip destination, "Wrong location?" pin fixing, group voting, live updates for the whole group
- Responsive layout (mobile → desktop), keyboard + screen-reader accessible, WCAG-AA colour contrast
- Row Level Security on every table; validated API routes; security headers

## Setup

```bash
npm install
cp .env.local.example .env.local      # then fill in your Supabase URL + anon key
```

(On Windows PowerShell: `Copy-Item .env.local.example .env.local`)

### Database (run in order — `supabase db push --db-url ...`, or paste each file into the Supabase SQL editor)

1. `20260804000000_init_schema.sql` — tables, base RLS
2. `20261006000000_security_hardening_and_invites.sql` — trip creation policies, `season_tags` lock-down, invite RPC, constraints
3. `20261006120000_import_scoring_and_limits.sql` — place category + drive legs, per-user AI usage quota
4. `20261007000000_destination_address_votes.sql` — trip destination, place address, group voting
5. `20261008000000_season_evidence_and_feedback.sql` — season-data evidence columns, in-app feedback table
6. `20261008000100_season_data_andhra_telangana.sql` — **generated**: 19 researched Andhra Pradesh / Telangana places
7. *(optional, dev only)* `seed.sql` — demo trip (put your own user UUID in it first)

**Run every migration before using the matching feature** — the app writes the new columns immediately.

### Supabase Auth settings

Dashboard → Authentication → URL Configuration:
- **Site URL:** your production URL
- **Redirect URLs:** add `http://localhost:3000/auth/callback` and `https://YOUR-DOMAIN/auth/callback`

### Run

```bash
npm run dev          # http://localhost:3000
npm run check        # typecheck + lint + tests
npm run build && npm start
```

## Project structure

```
proxy.ts                      session refresh + optimistic route protection (Next 16's "middleware")
app/
  page.tsx                    landing page
  login, signup, auth/callback
  trips/page.tsx              trip list + create
  trip/[id]/page.tsx          the planner (server component -> <TripPlanner/>)
  join/[code]/page.tsx        accept an invite
  api/trips                   POST create trip
  api/trips/[id]/optimize     POST auto-plan route
  api/places                  GET list / POST add stop
  api/places/[id]             DELETE stop
  fonts/                      self-hosted fonts (SIL OFL)
components/                   TripPlanner, RouteThread, StopCard, AddPlaceForm, InvitePanel, ui/*
lib/
  geo.ts                      haversine, nearest-neighbour ordering, day planning
  season.ts, dates.ts         season status by visit date; timezone-safe date helpers
  validation/schemas.ts       Zod schemas for all API input
  supabase/                   browser, server, and proxy clients
supabase/migrations           schema + RLS (never edit an applied migration — add a new one)
tests/                        vitest: geo, season/dates, validation, component rendering
```

## Season data (the heart of the product)

`data/season-tags.json` is the single source of truth. Each place has the good months, a plain-language reason,
`source_urls` and a `confidence` (`researched` = agrees across 2+ sources). To add or fix places:

1. Edit `data/season-tags.json`
2. `npm run build:season` (regenerates the SQL migration)
3. `npm test` — a quality gate checks months, coordinates (inside India, in the right region), sources, and that the SQL is in sync
4. Push the new migration

Coordinates are approximate (about 10 km) and are only used to match a user's pin to a record.

## Testing with real people

See `docs/TESTING_WITH_FRIENDS.md` — a 45-minute script, a pin-accuracy check and a "ready to show" checklist.
Testers can send feedback inside the app; read it in Supabase → Table Editor → `feedback`.

## Security model

- **Authorization is enforced by Postgres RLS**, not by the UI or `proxy.ts` (which only does
  optimistic redirects). Every table has policies; members can only touch their own trips.
- `season_tags` (your curated data) is public read-only; only the service role / dashboard can write.
- Clients can't add themselves to a trip — they join via `join_trip_by_code()` with a valid code.
- Users can only write location pings / media as themselves.
- API routes validate input with Zod, return generic errors (no raw DB messages), and never trust
  client-supplied `owner_id` / `added_by`.
- Only the **anon** key is used in the app. Never put the `service_role` key in `NEXT_PUBLIC_*`.

## Known limitations / roadmap

Highlights: place search/geocoding (replace manual lat/lng), real map, live group location,
driving-time-aware planning, CSP header, rate limiting, error monitoring, and a larger curated
`season_tags` dataset.
