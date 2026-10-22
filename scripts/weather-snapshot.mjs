// Saves a REAL Open-Meteo answer as test data (tests/fixtures/open-meteo). Run it after dark to add a night-time snapshot:
//   node scripts/weather-snapshot.mjs              (Hyderabad)
//   node scripts/weather-snapshot.mjs 17.97 79.59 warangal
// It asks exactly what the app asks (GMT, the same 8 values, 16 days) and stores the answer unchanged, with the URL and the time.
import { writeFileSync, mkdirSync } from "node:fs";

const [lat = "17.385", lng = "78.487", name = "hyderabad"] = process.argv.slice(2);
const fields = "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,visibility,wind_gusts_10m,is_day";
const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${fields}&forecast_days=16&timezone=GMT`;
const fetchedAt = new Date();
const res = await fetch(url);
if (!res.ok) { console.error(`Open-Meteo answered ${res.status}`); process.exit(1); }
const response = await res.json();
const ist = new Date(fetchedAt.getTime() + 330 * 60_000);
const stamp = `${ist.toISOString().slice(0, 10)}-${ist.toISOString().slice(11, 16).replace(":", "")}ist`;
const hour = ist.getUTCHours();
const note = `${hour >= 18 || hour < 6 ? "After-dark" : "Daytime"} fetch (${ist.toISOString().slice(11, 16)} IST). 16 days, times in GMT.`;
mkdirSync("tests/fixtures/open-meteo", { recursive: true });
const file = `tests/fixtures/open-meteo/${name}-${stamp}-16day.json`;
writeFileSync(file, JSON.stringify({ _meta: { source: "Open-Meteo forecast API (free tier), real response saved unchanged in `response`", url, fetchedAt: fetchedAt.toISOString(), note }, response }) + "\n");
console.log(`Saved ${file} (${note})`);
