// MapLibre GL 6 runs map drawing in a Web Worker and normally finds the worker file via
// `import.meta.url`. Turbopack rewrites that URL, so the worker "fails to load". We serve the
// worker ourselves from /public/maplibre and point MapLibre at it with setWorkerUrl() (TripMap.tsx).
// Copying from node_modules (instead of committing the files) keeps it in sync with the installed version.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "maplibre-gl", "dist");
const dest = join(root, "public", "maplibre");
// The worker imports ./maplibre-gl-shared.mjs, so both files must sit side by side.
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

if (!existsSync(src)) {
  console.warn("[maplibre] node_modules/maplibre-gl not found — run `npm install` first. Skipping worker copy.");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`[maplibre] copied ${files.length} worker files to public/maplibre`);
