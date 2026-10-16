import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSql, nextVersion, seasonMigrations } from "./season-sql.mjs";

// Turns data/season-tags.json into a migration. Never rewrites an existing one: Supabase does not re-run a migration that was
// applied before, so a change goes into a NEW file (a full, safe upsert of every place). Nothing changed → nothing written.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");
const { places } = JSON.parse(readFileSync(join(root, "data", "season-tags.json"), "utf8"));
const sql = buildSql(places);
const files = readdirSync(dir);
const latest = seasonMigrations(files).at(-1);
if (latest && readFileSync(join(dir, latest), "utf8") === sql) {
  console.log(`[season] up to date: ${latest} already holds these ${places.length} places. Nothing written.`);
} else {
  const name = `${nextVersion(files)}_season_data.sql`;
  writeFileSync(join(dir, name), sql);
  console.log(`[season] wrote ${places.length} places to NEW migration ${name}. Apply it with: npx supabase db push --db-url $db`);
}
