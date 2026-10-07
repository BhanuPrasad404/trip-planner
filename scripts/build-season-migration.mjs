import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSql } from "./season-sql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { places } = JSON.parse(readFileSync(join(root, "data", "season-tags.json"), "utf8"));
const out = join(root, "supabase", "migrations", "20261008000100_season_data_andhra_telangana.sql");
writeFileSync(out, buildSql(places));
console.log(`[season] wrote ${places.length} places to ${out}`);
