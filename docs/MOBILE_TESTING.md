# Testing on a phone (location + navigation need HTTPS)

Phones only share GPS with a page served over **HTTPS** (or `localhost`). `http://192.168.x.x:3000` will NOT work for Drive mode.

## Fastest: deploy to Vercel
1. Commit and push the project to GitHub; import the repo in Vercel (or push to the branch already connected).
2. Vercel → Project → Settings → Environment Variables (same names as `.env.local`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GEOCODER_USER_AGENT`, `INGEST_SECRET`, and **`NEXT_PUBLIC_SITE_URL` = your https Vercel URL**.
3. Supabase → Authentication → URL Configuration: add that https URL to **Site URL** and **Redirect URLs** (otherwise sign-in links go back to localhost).
4. Open the https URL on the phone and sign in.

## No Vercel yet: an HTTPS tunnel to your laptop
Run `npm run dev`, then in a second terminal `npx localtunnel --port 3000` (prints an https URL). Use that URL on the phone and add it to Supabase Redirect URLs + `NEXT_PUBLIC_SITE_URL`. (Keep the laptop awake; the URL changes each run.)

## What to check on the phone (outdoors, location ON, Chrome)
1. Open the trip → **Map** → **Start drive**; allow location.
2. Wait for "Accurate to about N m" (starts outdoors; indoors it may say "rough" — walk to a window/outside).
3. Confirm the start card → a **blue route** to the next stop appears by itself, with distance and ETA.
4. Zoom out / pan: the map must stay where you put it and a **Re-centre** button appears.
5. Drive / walk: the dot moves, remaining distance shrinks. Take a wrong turn: it re-routes once after a few seconds.

Public OSRM routing and OpenFreeMap tiles are free demo services: fine for this test, not for launch.
