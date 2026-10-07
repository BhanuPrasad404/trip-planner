// Pre-load a region of the map into Trailmate's own places database.
//   node scripts/ingest-region.mjs <south> <west> <north> <east>
// Example — Andhra Pradesh + Telangana (about 12.6–19.9 N, 76.7–84.8 E), in pieces:
//   node scripts/ingest-region.mjs 15 77 20 85
//   node scripts/ingest-region.mjs 12.5 77 15 85
// Needs the dev server (or your deployed site) running, and INGEST_SECRET + SUPABASE_SERVICE_ROLE_KEY set in .env.local.
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env.local — rely on the real environment */ }
}
loadEnv();

const [south, west, north, east] = process.argv.slice(2, 6).map(Number);
if ([south, west, north, east].some((n) => !Number.isFinite(n))) {
  console.error("Usage: node scripts/ingest-region.mjs <south> <west> <north> <east>");
  process.exit(1);
}
const secret = process.env.INGEST_SECRET;
if (!secret || secret.length < 16) {
  console.error("Set INGEST_SECRET (at least 16 characters) in .env.local first, then restart `npm run dev`.");
  process.exit(1);
}
const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

let totalPlaces = 0;
for (let round = 1; round <= 500; round++) {
  const res = await fetch(`${base}/api/admin/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": secret },
    body: JSON.stringify({ south, west, north, east, max_tiles: 10 }),
  });
  if (res.status === 404) { console.error("The ingest route is off. Is INGEST_SECRET set and the server restarted?"); process.exit(1); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("Failed:", res.status, body.error ?? ""); process.exit(1); }
  totalPlaces += body.places;
  console.log(`round ${round}: ${body.ingested} tiles done, ${body.failed} failed, +${body.places} places, ${body.remaining} left (store: ${body.store})`);
  if (body.remaining === 0) break;
  if (body.ingested === 0) { console.error("No progress (the map server may be busy). Wait a few minutes and run the same command again."); process.exit(2); }
}
console.log(`Done. ${totalPlaces} places added.`);
