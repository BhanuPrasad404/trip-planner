// Run this yourself (it needs the internet; the build/CI never calls it):
//   node scripts/check-wikimedia-widths.mjs
// It asks Wikimedia for one real photo (the Charminar article's lead image) and requests it at the widths TrailMate uses
// (THUMB_WIDTHS in lib/place-photos/safety.ts) plus two non-standard widths, then prints what came back.
// Why: Wikimedia only pre-renders a fixed set of thumbnail widths and may refuse others. This tells you which are safe.
const UA = process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)";
const WIDTHS = (process.argv[2] || "120,250,330,500,480,320").split(",").map(Number); // 480 and 320 are the OLD, non-standard sizes
const get = (url, init = {}) => fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000), ...init });

const api = new URLSearchParams({ action: "query", format: "json", formatversion: "2", titles: "Charminar", prop: "pageimages", piprop: "thumbnail", pithumbsize: "500" });
const j = await (await get(`https://en.wikipedia.org/w/api.php?${api}`)).json();
const src = j?.query?.pages?.[0]?.thumbnail?.source;
if (!src) { console.error("Could not get a sample photo from Wikipedia:", JSON.stringify(j).slice(0, 300)); process.exit(1); }
console.log("Sample photo:", src, "\nUser-Agent:", UA, "\n");

for (const w of WIDTHS) {
  const url = src.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
  try {
    const r = await get(url, { method: "HEAD" });
    console.log(`${String(w).padStart(4)} px  ->  HTTP ${r.status}  ${r.headers.get("content-length") ?? "?"} bytes  ${r.headers.get("content-type") ?? ""}`);
  } catch (e) {
    console.log(`${String(w).padStart(4)} px  ->  failed: ${e instanceof Error ? e.message : e}`);
  }
}
console.log("\nAny width that is not HTTP 200 must be removed from THUMB_WIDTHS (and the geosearch sizes 500/330).");
