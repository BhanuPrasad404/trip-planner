# Trailmate

Season-aware trip planner with live group location. Built with Next.js 16 (App Router), Tailwind v4, and Supabase.

## What's already built

- Full design system (colors, fonts) applied via Tailwind theme in `app/globals.css`
- `RouteThread` — the signature day-navigation component
- `StopCard` + `SeasonBadge` — itinerary stops with automatic season-status flagging
- `AddPlaceForm` — add a stop to any day, wired directly to Supabase
- `/api/places` and `/api/trips` — working API routes
- Full database schema with Row Level Security in `supabase/schema.sql`
- Seed data with real Maharashtra places in `supabase/seed.sql`

## Setup — exact steps

### 1. Install dependencies
```bash
npm install
```

### 2. Create a Supabase project
Go to [supabase.com](https://supabase.com) → New Project. Wait for it to finish provisioning.

### 3. Run the schema
Supabase Dashboard → SQL Editor → paste the entire contents of `supabase/schema.sql` → Run.

### 4. Create a test user
Supabase Dashboard → Authentication → Users → Add user. Copy the generated User UID.

### 5. Run the seed data
Open `supabase/seed.sql`, replace both instances of `YOUR_USER_ID` with the UID you just copied,
then paste the whole file into the SQL Editor and run it.

### 6. Set your environment variables
```bash
cp .env.local.example .env.local
```
Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — both found in
Supabase Dashboard → Project Settings → API.

### 7. Run it
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000), then visit:
```
http://localhost:3000/trip/00000000-0000-0000-0000-000000000001
```
That's the seeded demo trip — you should see Day 3 with Kalu Waterfall flagged as wrong-season,
exactly like the design mockup.

## Project structure

```
app/
  page.tsx                 → landing page
  trip/[id]/page.tsx        → server component, fetches trip + places
  api/places/route.ts       → GET places for a trip
  api/trips/route.ts        → POST create a new trip
components/
  TripPlanner.tsx            → main client component, assembles everything
  RouteThread.tsx             → signature day-selector
  StopCard.tsx                 → single itinerary stop
  SeasonBadge.tsx               → good/wrong-season/unknown pill
  AddPlaceForm.tsx               → add-stop form, writes to Supabase
lib/
  supabase/client.ts          → browser Supabase client
  supabase/server.ts          → server Supabase client
  types/index.ts                → TypeScript types matching the schema
supabase/
  schema.sql                    → full DB schema + RLS policies
  seed.sql                       → sample data to see it working immediately
```

## What's NOT built yet (your next steps)

1. **Auth UI** — sign up / login screens. Supabase Auth is wired in the API routes, but there's
   no login form yet. Start here — https://supabase.com/docs/guides/auth/quickstarts/nextjs
2. **Real map view** — the mockup's map is illustrative. Wire in Google Maps JS API or Mapbox
   using the `lat`/`lng` already stored on every place.
3. **Live group location** — the `location_pings` table and Realtime are ready in the schema;
   you need a background geolocation watcher (`navigator.geolocation.watchPosition`) that writes
   to it, and a subscriber that shows pins on the map.
4. **Real-time stop detection** — the "you've stopped, want food nearby?" companion feature.
   Needs a Redis/BullMQ job checking recent location pings for a stationary pattern, then a
   Google Places API call.
5. **Trip creation form** — right now trips only exist via the seed SQL. Build a simple form that
   POSTs to `/api/trips`.

Build in that order — auth first, since everything else depends on knowing who the user is.
