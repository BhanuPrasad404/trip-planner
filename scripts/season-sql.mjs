// Turns data/season-tags.json into an idempotent SQL migration (upsert by lower(place_name)).
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (a) => `array[${a.map(q).join(", ")}]::text[]`;

export function buildSql(places) {
  const values = places
    .map(
      (p) =>
        `  (${q(p.place_name)}, ${p.lat}, ${p.lng}, ${q(p.category)}, array[${p.good_months.join(", ")}]::int[], ` +
        `${q(p.reason)}, ${q(p.region)}, ${q(p.confidence)}, ${arr(p.source_urls)}, ${q(p.last_checked)}::date)`
    )
    .join(",\n");

  return `-- ============================================================================
-- TRAILMATE — curated season data (${places.length} places: ${[...new Set(places.map((p) => p.region))].sort().join(", ")})
-- GENERATED from data/season-tags.json by scripts/build-season-migration.mjs — do not edit by hand;
-- edit the JSON and run \`npm run build:season\`. Safe to re-run (upserts by place name).
-- ============================================================================

insert into public.season_tags
  (place_name, lat, lng, category, good_months, reason, region, confidence, source_urls, last_checked)
values
${values}
on conflict (lower(place_name)) do update set
  lat = excluded.lat,
  lng = excluded.lng,
  category = excluded.category,
  good_months = excluded.good_months,
  reason = excluded.reason,
  region = excluded.region,
  confidence = excluded.confidence,
  source_urls = excluded.source_urls,
  last_checked = excluded.last_checked;
`;
}

// ── Which migration file holds the season data ──
// A migration that was applied once is never run again by Supabase, so changed season data must go into a NEW migration file
// (the SQL is a full, idempotent upsert of every place, so applying the newest one is all that is needed).
export const SEASON_FILE_RE = /^(\d{14})_season_data[a-z0-9_]*\.sql$/;

/** The season-data migrations among `files` (file names), oldest first. */
export function seasonMigrations(files) {
  return files.filter((f) => SEASON_FILE_RE.test(f)).sort();
}

/** A version number after EVERY existing migration (Supabase refuses to push one that sorts before what is already applied). */
export function nextVersion(files, now = new Date()) {
  const stamp = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const latest = files.map((f) => /^(\d{14})_/.exec(f)?.[1]).filter(Boolean).sort().at(-1) ?? "0";
  const fromClock = stamp(now);
  if (fromClock > latest) return fromClock;
  const n = BigInt(latest) + 1n;
  return n.toString().padStart(14, "0");
}
