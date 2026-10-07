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
-- TRAILMATE — curated season data: Andhra Pradesh & Telangana (${places.length} places)
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
