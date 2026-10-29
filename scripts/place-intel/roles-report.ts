// Slice A on REAL data, offline: the place-level rules (lib/place-intel/role.ts) over every place in the catalogue extracts, and the
// "sights in or around" ranking (lib/place-intel/attractions.ts) for every town and city in our India index.
//   npx tsx scripts/place-intel/roles-report.ts [osm extract folder] [wikidata extract folder]
// Writes reports/place-intel/roles.md. Reads files only (no network, no database). The two sources are joined the way the database
// joins them (catalog_merge: the map owns name, kind and position; Wikidata owns its type and links). Each place's state is the
// extract's nearest-town state (the database uses the real borders), so a place right at a state border may be counted on either side.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { findNamed } from "@/lib/places/geo-index";
import type { CatalogRow } from "@/lib/catalog/types";
import { placeRole, type PlaceRole } from "@/lib/place-intel/role";
import { rankAttractions, regionCodeOf, searchRadiusKm, type CatalogSite, type Parent } from "@/lib/place-intel/attractions";
import type { PlaceKind } from "@/lib/places/types";

const base = path.join(os.homedir(), "trailmate-data", "roles-run");
const osmDir = process.argv[2] ?? path.join(base, "osm-2026-10-28");
const wdDir = process.argv[3] ?? path.join(base, "wikidata-2026-10-29");

function readRows(dir: string): { rows: CatalogRow[]; date: string } {
  const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { dataDate: string; batches: string[] };
  return { rows: m.batches.flatMap((b) => JSON.parse(readFileSync(path.join(dir, b), "utf8")) as CatalogRow[]), date: m.dataDate };
}

function join(osm: { rows: CatalogRow[]; date: string }, wd: { rows: CatalogRow[]; date: string }): CatalogSite[] {
  const out = new Map<string, CatalogSite>();
  const notable = (r: CatalogSite) => !!(r.wikidata || r.wikipedia || r.heritage);
  for (const r of wd.rows) {
    out.set(r.key, { key: r.key, name: r.name, category: r.category, lat: r.lat, lng: r.lng, notable: false, heritage: r.heritage, wikidata: r.wikidata, wikipedia: r.wikipedia, sitelinks: r.sitelinks ?? 0,
      hours: null, website: r.website, osm_id: null, osm_date: null, wd_date: wd.date, region_code: r.state_code ?? null, wd_type: r.wd_type ?? null, osm_type: null,
      located_in: r.located_in ?? null, located_in_name: r.located_in_name ?? null, part_of: r.part_of ?? null });
  }
  for (const r of osm.rows) {
    const old = out.get(r.key);
    out.set(r.key, { ...(old ?? { sitelinks: 0, wd_date: null, wd_type: null, located_in: null, located_in_name: null, part_of: null }),
      key: r.key, name: r.name, category: r.category, lat: r.lat, lng: r.lng, notable: false, heritage: r.heritage || !!old?.heritage, wikidata: r.wikidata ?? old?.wikidata ?? null,
      wikipedia: r.wikipedia ?? old?.wikipedia ?? null, hours: r.hours, website: r.website ?? old?.website ?? null, osm_id: r.osm_id ?? null, osm_date: osm.date,
      region_code: r.state_code ?? old?.region_code ?? null, osm_type: r.osm_type ?? null } as CatalogSite);
  }
  return [...out.values()].map((r) => ({ ...r, notable: notable(r) }));
}

async function main() {
  const osm = readRows(osmDir), wd = readRows(wdDir);
  const sites = join(osm, wd);
  const withType = { wd: sites.filter((s) => s.wd_type).length, osm: sites.filter((s) => s.osm_type).length, located: sites.filter((s) => s.located_in).length, partOf: sites.filter((s) => s.part_of).length };

  // ── Roles of every catalogue place ──
  const partsCount = new Map<string, number>();
  for (const s of sites) if (s.part_of) partsCount.set(s.part_of, (partsCount.get(s.part_of) ?? 0) + 1);
  const roleCount: Record<PlaceRole, number> = { settlement: 0, area: 0, site: 0, complex: 0, unknown: 0 };
  const conf: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const hoursFit: Record<string, number> = {};
  const areaSamples: string[] = [], complexSamples: string[] = [], mediumWhy: Record<string, number> = {};
  for (const s of sites) {
    const c = s.wikidata ? partsCount.get(s.wikidata) ?? 0 : 0;
    const r = placeRole({ name: s.name, category: s.category, wdType: s.wd_type, osmType: s.osm_type, parts: c >= 2 ? { count: c, by: "wikidata" } : null });
    roleCount[r.role]++; conf[r.confidence]++; hoursFit[r.hours] = (hoursFit[r.hours] ?? 0) + 1;
    if (r.role === "area" && areaSamples.length < 12) areaSamples.push(`${s.name} (${s.region_code ?? "?"})`);
    if (r.role === "complex" && complexSamples.length < 12) complexSamples.push(`${s.name} (${s.region_code ?? "?"}, ${c} parts)`);
    if (r.confidence !== "high") mediumWhy[`${r.confidence}: ${r.reasons[0].replace(/under \w+$/, "under <kind>")}`] = (mediumWhy[`${r.confidence}: ${r.reasons[0].replace(/under \w+$/, "under <kind>")}`] ?? 0) + 1;
  }

  // ── Every town and city in the index: what does it offer? ──
  const ix = (await loadGeoIndex())!;
  const CELL = 0.3;
  const grid = new Map<string, CatalogSite[]>();
  for (const s of sites) { const k = `${Math.floor(s.lat / CELL)}|${Math.floor(s.lng / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(s); }
  const around = (lat: number, lng: number) => { const out: CatalogSite[] = []; const gy = Math.floor(lat / CELL), gx = Math.floor(lng / CELL); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...(grid.get(`${gy + dy}|${gx + dx}`) ?? [])); return out; };
  const towns = ix.entries.filter((e) => e.kind === "city" || e.kind === "town");
  let anySite = 0, notableSite = 0, emptyWithRows = 0, dupNames = 0, wrongState = 0;
  const parentOf = (e: (typeof towns)[number]): Parent => ({ name: e.name, lat: e.lat, lng: e.lng, kind: e.kind as PlaceKind, population: e.pop, state: e.state });
  for (const e of towns) {
    const p = parentOf(e);
    const l = rankAttractions(p, around(e.lat, e.lng));
    if (l.items.length) anySite++;
    if (l.items.some((a) => a.notable)) notableSite++;
    if (!l.items.length && l.dropped.outside + l.dropped.otherState === 0 && around(e.lat, e.lng).some((s) => Math.hypot(s.lat - e.lat, s.lng - e.lng) < searchRadiusKm(p) / 111 * 0.7)) emptyWithRows++;
    const names = l.items.map((a) => a.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      // the same name can be two real places far apart in one town (two "Hanuman Temple"s): only count ones under 500 m apart (should be 0)
      for (let i = 0; i < l.items.length; i++) for (let j = i + 1; j < l.items.length; j++) if (names[i] === names[j] && Math.hypot(l.items[i].lat - l.items[j].lat, l.items[i].lng - l.items[j].lng) < 0.0045) dupNames++;
    }
    const code = regionCodeOf(p.state);
    wrongState += l.items.filter((a) => code && a.regionCode && a.regionCode !== code).length;
  }

  // ── Sample lists: the labelled settlements, mostly not the owner's examples ──
  const fx = JSON.parse(readFileSync("tests/fixtures/place-intel/roles.json", "utf8")) as { index: { name: string; state: string; role: string; example?: boolean }[] };
  const samples: string[] = [];
  for (const c of fx.index.filter((x) => x.role === "settlement")) {
    // Found the way the app finds a typed name (findNamed), in the labelled state.
    const hit = findNamed(ix, c.name, { kinds: ["city", "town"], limit: 8 }).find((h) => h.state?.toLowerCase().startsWith(c.state.toLowerCase().split(" and ")[0]));
    const e = hit ? towns.find((t) => `gn:${t.i}` === hit.id) : undefined;
    if (!e) { samples.push(`| ${c.name} | ${c.state} | not a town or city in the index | | |`); continue; }
    const l = rankAttractions(parentOf(e), around(e.lat, e.lng), { limit: 3 });
    // SHOW=Name1,Name2 prints the full top 10 with scores (for checking a ranking by eye).
    if ((process.env.SHOW ?? "").split(",").includes(c.name)) for (const a of rankAttractions(parentOf(e), around(e.lat, e.lng), { limit: 10 }).items) console.log(`${c.name}: ${a.score.toFixed(2)} ${a.name} [${a.km} km] ${a.reasons.join("; ")}`);
    const top = l.items.map((a) => `**${a.name}** (${a.category}${a.role.role === "complex" ? `, complex of ${a.parts}` : ""}): ${a.reasons.slice(0, 3).join("; ")}`).join("<br>");
    samples.push(`| ${c.name}${c.example ? " (example)" : ""} | ${c.state} | ${l.parent.role.reasons[0]} | ${l.items.length ? top : "no catalogue place within reach"} | ${l.dropped.otherState} other-state, ${l.dropped.parts} parts folded, ${l.dropped.duplicates} duplicates |`);
  }

  const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 1000) / 10 : 0}% (${a.toLocaleString("en-IN")}/${b.toLocaleString("en-IN")})`;
  const L: string[] = [];
  L.push("# Slice A on real data: place levels and the sights around a town", "");
  L.push(`Made by \`scripts/place-intel/roles-report.ts\` from the catalogue extracts (OpenStreetMap ${osm.date}, Wikidata ${wd.date}) and the India index that ships with the repo. Offline: no network, no database.`, "");
  L.push("**Approximation:** each place's state here is the state of its nearest town in our index (the database uses the real borders). Real-world correctness of the rankings is NOT measured here; it needs a person to look at them (see the samples).", "");
  L.push("## The catalogue now knows what each place is", "", "| Field | Places that have it |", "|---|---|");
  L.push(`| Wikidata type | ${pct(withType.wd, sites.length)} |`, `| Map tag | ${pct(withType.osm, sites.length)} |`, `| Wikidata "located in" | ${pct(withType.located, sites.length)} |`, `| Wikidata "part of" | ${pct(withType.partOf, sites.length)} |`, "");
  L.push("## Role of every catalogue place", "", "| Role | Places |", "|---|---|");
  for (const [k, v] of Object.entries(roleCount)) L.push(`| ${k} | ${pct(v, sites.length)} |`);
  L.push("", "| Opening hours | Places |", "|---|---|");
  for (const [k, v] of Object.entries(hoursFit)) L.push(`| ${k} | ${pct(v, sites.length)} |`);
  L.push("", `Confidence: high ${pct(conf.high, sites.length)}, medium ${pct(conf.medium, sites.length)}, low ${pct(conf.low, sites.length)}.`, "");
  L.push("Where confidence is not high, and why:", "", "| Why | Places |", "|---|---|");
  for (const [k, v] of Object.entries(mediumWhy).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v.toLocaleString("en-IN")} |`);
  L.push("", `Areas found in the catalogue (sample): ${areaSamples.join(", ") || "none"}.`, "", `Complexes (sample): ${complexSamples.join(", ") || "none"}.`, "");
  L.push("## Every town and city in the index", "", `Towns and cities: ${towns.length.toLocaleString("en-IN")}.`, "");
  L.push(`- With at least one sight within reach: ${pct(anySite, towns.length)}`, `- With at least one NOTABLE sight within reach: ${pct(notableSite, towns.length)}`, `- Same name twice under 500 m apart in one list (should be 0): ${dupNames}`, `- Suggestions in a different state from the town (should be 0): ${wrongState}`, `- Places within reach in the catalogue but an empty list (should be 0): ${emptyWithRows}`, "");
  L.push("## The labelled towns and cities: top 3 with reasons", "", "| Place | State | What it is | Top suggestions (reasons) | Left out |", "|---|---|---|---|---|", ...samples, "");
  mkdirSync("reports/place-intel", { recursive: true });
  writeFileSync("reports/place-intel/roles.md", L.join("\n") + "\n");
  console.log(L.slice(0, 40).join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
