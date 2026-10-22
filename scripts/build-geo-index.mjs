// Builds data/geo/india-places.json.gz: Trailmate's own India place-name index, used for instant type-ahead and for naming the
// traveller's current location without calling an outside service.
//
// Source: GeoNames (https://www.geonames.org), licence CC BY 4.0. The app shows this credit wherever the results appear.
// Input files (download them yourself, then run this script):
//   https://download.geonames.org/export/dump/IN.zip            (unzip → IN.txt)
//   https://download.geonames.org/export/dump/admin1CodesASCII.txt
//   https://download.geonames.org/export/dump/admin2Codes.txt
// Usage: node scripts/build-geo-index.mjs <folder with the three files>
//
// What goes in (about 65k of GeoNames' 660k Indian rows): every place with a population, every district and state capital, city
// neighbourhoods and the villages and localities inside the big cities (so "near me" names the right part of Hyderabad), mandals
// and tehsils, districts, and the kinds of places a traveller looks for (temples, forts, waterfalls, lakes, peaks, passes, beaches,
// parks). Abandoned or historical settlements are left out.
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("Usage: node scripts/build-geo-index.mjs <folder with IN.txt, admin1CodesASCII.txt, admin2Codes.txt>"); process.exit(1); }
const OUT = path.join(process.cwd(), "data", "geo", "india-places.json.gz");

const SIGHT = new Set(["TMPL", "FT", "MNMT", "RUIN", "HSTS", "SHRN", "MSQE", "CH", "CSTL", "PAL", "MUS", "ZOO", "OBPT", "GDN"]);
const WATER = new Set(["FLLS", "LK", "LKS", "LGN", "HSP", "SPNG"]);
const COAST_H = new Set(["BAY"]);
const HILL = new Set(["PK", "PASS", "MT", "MTS", "HLL", "HLLS", "CLF", "VAL", "GRGE", "CAVE"]);
const COAST_T = new Set(["BCH", "BCHS", "CAPE", "PT", "ISL"]);
const PARK = new Set(["PRK", "RES", "RESN", "RESW"]);
const BIG_CITY_POP = 500_000;
const URBAN_KM = 25;

const readLines = (file) => readFileSync(path.join(dir, file), "utf8").split("\n").filter(Boolean);

const states = new Map(); // "IN.40" -> name
for (const line of readLines("admin1CodesASCII.txt")) { const [code, , ascii] = line.split("\t"); if (code.startsWith("IN.")) states.set(code, ascii); }
const districts = new Map(); // "IN.40.536" -> name
for (const line of readLines("admin2Codes.txt")) { const [code, , ascii] = line.split("\t"); if (code.startsWith("IN.")) districts.set(code, ascii.replace(/\s+District$/i, "")); }

async function* rows() {
  const rl = createInterface({ input: createReadStream(path.join(dir, "IN.txt"), "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split("\t");
    if (c.length < 19) continue;
    yield { id: c[0], ascii: c[2], alts: c[3], lat: Number(c[4]), lng: Number(c[5]), cls: c[6], code: c[7], a1: c[10], a2: c[11], pop: Number(c[14]) || 0 };
  }
}

// Pass 1: the big cities, to know which unnamed-population villages are really city localities.
const big = [];
for await (const r of rows()) if (r.cls === "P" && r.pop >= BIG_CITY_POP) big.push(r);
const nearBig = (r) => big.some((b) => { const dy = (r.lat - b.lat) * 111, dx = (r.lng - b.lng) * 111 * Math.cos((b.lat * Math.PI) / 180); return dx * dx + dy * dy < URBAN_KM * URBAN_KM; });

function kindOf(r) {
  if (r.cls === "P") {
    if (r.code === "PPLQ" || r.code === "PPLH" || r.code === "PPLW") return null;
    if (r.code === "PPLC" || r.code === "PPLA" || r.code === "PPLA2" || r.pop >= 100_000) return "city";
    if (r.pop > 0 || /^PPLA[345]$/.test(r.code)) return "town";
    if (r.code === "PPLX" || nearBig(r)) return "locality";
    return null;
  }
  if (r.cls === "A") return r.code === "ADM1" ? "state" : r.code === "ADM2" ? "district" : r.code === "ADM3" ? "subdistrict" : null;
  if (r.cls === "S") return SIGHT.has(r.code) ? "sight" : null;
  if (r.cls === "H") return WATER.has(r.code) ? "water" : COAST_H.has(r.code) ? "coast" : null;
  if (r.cls === "T") return HILL.has(r.code) ? "hill" : COAST_T.has(r.code) ? "coast" : null;
  if (r.cls === "L") return PARK.has(r.code) ? "park" : null;
  return null;
}

// Other names people really type: Latin ("Bangalore", "Coorg", "HYD"), and the place's own name in Indian scripts ("హైదరాబాద్",
// "दिल्ली", "சென்னை", "ಬೆಂಗಳೂರು"), so a traveller writing in Telugu, Hindi, Tamil, Kannada or Marathi is understood without AI.
// The scripts Trailmate reads: Devanagari (Hindi, Marathi), Telugu, Tamil, Kannada — at most 2 spellings each.
const SCRIPTS = [/^[ऀ-ॿ\s.'-]+$/u, /^[ఀ-౿\s.'-]+$/u, /^[஀-௿\s.'-]+$/u, /^[ಀ-೿\s.'-]+$/u];
const INDIC_KINDS = new Set(["city", "town", "district", "subdistrict", "state", "sight", "water", "coast", "park"]);
function altNames(r, kind) {
  if (!r.alts) return [];
  const own = r.ascii.toLowerCase();
  const latin = [], perScript = SCRIPTS.map(() => []);
  for (const a of r.alts.split(",")) {
    const t = a.trim();
    if (t.length < 2 || t.length > 40 || t.toLowerCase() === own) continue;
    if (/^[A-Z][A-Za-z .'-]*$/.test(t) && t.length >= 3 && latin.length < 5 && !latin.includes(t)) { latin.push(t); continue; }
    if (!INDIC_KINDS.has(kind)) continue;
    const s = SCRIPTS.findIndex((re) => re.test(t));
    if (s >= 0 && perScript[s].length < 4 && !perScript[s].includes(t)) perScript[s].push(t);
  }
  return [...latin, ...(NICKNAMES[`${kind}:${r.ascii}`] ?? []), ...perScript.flat()];
}

// Everyday names GeoNames doesn't carry, for well-known places only (fact, not guesswork: these are how people say them).
const NICKNAMES = {
  "city:Visakhapatnam": ["Vizag", "Vishakapatnam"], "city:Puducherry": ["Pondy", "Pondicherry"], "city:Chennai": ["Madras"], "city:Kolkata": ["Calcutta"],
  "city:Thiruvananthapuram": ["Trivandrum"], "city:Kochi": ["Cochin"], "city:Mangaluru": ["Mangalore"], "city:Mysuru": ["Mysore"], "city:Vadodara": ["Baroda"],
  "city:Gurugram": ["Gurgaon"], "city:Prayagraj": ["Allahabad"], "city:Varanasi": ["Benares", "Kashi"], "city:Kozhikode": ["Calicut"], "city:Hubballi": ["Hubli"],
  "city:Belagavi": ["Belgaum"], "city:Tiruchirappalli": ["Trichy"], "city:Thoothukudi": ["Tuticorin"], "city:Rajamahendravaram": ["Rajahmundry"],
};

const stateList = [], stateIdx = new Map();
const districtList = [], districtIdx = new Map();
const idxOf = (list, map, key, name) => { if (!name) return -1; if (!map.has(key)) { map.set(key, list.length); list.push(name); } return map.get(key); };

const out = [];
const counts = {};
for await (const r of rows()) {
  const kind = kindOf(r);
  if (!kind || !r.ascii || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
  const s = idxOf(stateList, stateIdx, `IN.${r.a1}`, states.get(`IN.${r.a1}`));
  const d = kind === "district" || kind === "state" ? -1 : idxOf(districtList, districtIdx, `IN.${r.a1}.${r.a2}`, districts.get(`IN.${r.a1}.${r.a2}`));
  const alts = kind === "locality" ? [] : altNames(r, kind);
  const row = [r.ascii.trim().slice(0, 80), Math.round(r.lat * 1e5) / 1e5, Math.round(r.lng * 1e5) / 1e5, kind, s, d, r.pop];
  if (alts.length) row.push(alts);
  out.push(row);
  counts[kind] = (counts[kind] ?? 0) + 1;
}

const index = {
  version: 1,
  source: "GeoNames (geonames.org), CC BY 4.0",
  built: new Date().toISOString().slice(0, 10),
  columns: ["name", "lat", "lng", "kind", "state", "district", "population", "otherNames?"],
  states: stateList,
  districts: districtList,
  rows: out,
};
mkdirSync(path.dirname(OUT), { recursive: true });
const gz = gzipSync(Buffer.from(JSON.stringify(index)), { level: 9 });
writeFileSync(OUT, gz);
console.log(`Wrote ${out.length} places (${(gz.length / 1e6).toFixed(2)} MB gzipped) to ${OUT}`, counts);
