# Launch checklist

Things that are fine while Trailmate is being built, but MUST be done before the public launch (real users, ads or subscriptions).
Tick each one off here when it is done, with the date.

## Licences and paid services

- [ ] **Weather: buy the Open-Meteo commercial plan and set the key.**
  The free Open-Meteo API is for non-commercial use only ("You may only use the free API services for non-commercial purposes",
  https://open-meteo.com/en/terms). Trailmate will make money, so it needs the commercial plan (https://open-meteo.com/en/pricing).
  How: put the key in `OPEN_METEO_API_KEY` (Vercel → Settings → Environment Variables, and `.env.local` for local runs), then redeploy.
  No code changes: with the key set, every weather request goes to Open-Meteo's customer servers (`customer-api.open-meteo.com`,
  `customer-archive-api.open-meteo.com`) with `&apikey=`. Check after deploying: the weather still loads on a trip's Live page.
  Note the free limits until then: under 10,000 calls a day, 5,000 an hour and 600 a minute, counted per IP address; Open-Meteo warns
  that shared hosting such as Vercel can reach them sooner.
- [ ] Routing, places and map tiles: the public OSRM, Overpass and OpenFreeMap servers are for light testing only. Set your own or paid
  servers (`OSRM_BASE_URL`, `OVERPASS_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`). See docs/START_HERE.md.
