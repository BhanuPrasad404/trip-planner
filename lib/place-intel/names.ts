// Is this map object the same place as that one? Names only (the caller checks distance and ids): 0 = surely different, 1 = same name.
// Built for Indian place names as people and maps actually write them:
//   • the same name in an Indian script is read in Latin letters first ("చార్మినార్" → "charminar"), for all the Brahmi-family scripts;
//   • transliteration variants fold together ("Golkonda"/"Golconda", "Brihadeeswarar"/"Brihadisvara", "Mysore"/"Mysuru");
//   • honorifics and fillers don't count ("Sri", "Swamy", "the", "of");
//   • a different KIND of place is never the same place: a temple is not a beach, a fort is not a dam;
//   • a facility named after a place is not that place: "… Restaurant", "… Metro Station", "… Road", "… Hotel";
//   • other names (aliases from the data: alt_name, Wikidata labels, a name in brackets) are tried too.
// Pure, no place names inside: only generic words.

// ── Indian scripts → Latin letters (one table: these scripts share their layout, offset from each block's start) ──────────────────
const BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00]; // Devanagari … Malayalam
const VOWEL: Record<number, string> = { 0x05: "a", 0x06: "aa", 0x07: "i", 0x08: "ii", 0x09: "u", 0x0a: "uu", 0x0b: "ri", 0x0c: "li", 0x0d: "e", 0x0e: "e", 0x0f: "e", 0x10: "ai", 0x11: "o", 0x12: "o", 0x13: "o", 0x14: "au" };
const SIGN: Record<number, string> = { 0x3e: "aa", 0x3f: "i", 0x40: "ii", 0x41: "u", 0x42: "uu", 0x43: "ri", 0x44: "rri", 0x45: "e", 0x46: "e", 0x47: "e", 0x48: "ai", 0x49: "o", 0x4a: "o", 0x4b: "o", 0x4c: "au", 0x57: "au" };
const CONS: Record<number, string> = {
  0x15: "k", 0x16: "kh", 0x17: "g", 0x18: "gh", 0x19: "ng", 0x1a: "ch", 0x1b: "chh", 0x1c: "j", 0x1d: "jh", 0x1e: "ny", 0x1f: "t", 0x20: "th", 0x21: "d", 0x22: "dh", 0x23: "n",
  0x24: "t", 0x25: "th", 0x26: "d", 0x27: "dh", 0x28: "n", 0x29: "n", 0x2a: "p", 0x2b: "ph", 0x2c: "b", 0x2d: "bh", 0x2e: "m", 0x2f: "y", 0x30: "r", 0x31: "r", 0x32: "l", 0x33: "l", 0x34: "zh",
  0x35: "v", 0x36: "sh", 0x37: "sh", 0x38: "s", 0x39: "h", 0x58: "q", 0x59: "kh", 0x5a: "gh", 0x5b: "z", 0x5c: "r", 0x5d: "rh", 0x5e: "f", 0x5f: "y",
};
const VIRAMA = 0x4d, ANUSVARA = 0x02, CANDRABINDU = 0x01, VISARGA = 0x03, NUKTA = 0x3c;

/** Latin letters for any Brahmi-family text (other characters pass through unchanged). Rough, but the same rough both ways. */
export function romanize(s: string): string {
  let out = "";
  const cps = [...s].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    const base = BLOCKS.find((b) => cp >= b && cp < b + 0x80);
    if (base === undefined) { out += String.fromCodePoint(cp); continue; }
    const o = cp - base;
    if (CONS[o] !== undefined) {
      out += CONS[o];
      let j = i + 1;
      while (j < cps.length && cps[j] - base === NUKTA) j++;
      const next = j < cps.length ? cps[j] - base : -1;
      const nextInBlock = j < cps.length && cps[j] >= base && cps[j] < base + 0x80;
      if (!(nextInBlock && (next === VIRAMA || SIGN[next] !== undefined))) out += "a"; // the vowel every consonant carries unless told otherwise
      i = j - 1;
    } else if (SIGN[o] !== undefined) out += SIGN[o];
    else if (VOWEL[o] !== undefined) out += VOWEL[o];
    else if (o === ANUSVARA || o === CANDRABINDU) out += "n";
    else if (o === VISARGA) out += "h";
    else if (o === VIRAMA || o === NUKTA) continue;
    else if (o >= 0x66 && o <= 0x6f) out += String(o - 0x66);
    else out += " ";
  }
  return out;
}

// ── Folding Latin spellings of Indian names ────────────────────────────────────────────────────────────────────────────────────────
/** One spelling for the many ways one sound is written: aspirates, long vowels, w/v, c/k, z/j, doubled letters. */
export function foldWord(w: string): string {
  let s = w.replace(/x/g, "ks").replace(/q/g, "k").replace(/z/g, "j").replace(/w/g, "v").replace(/ph/g, "f");
  s = s.replace(/([bcdgjkpt])h/g, "$1").replace(/sh/g, "s").replace(/c/g, "k");
  s = s.replace(/aa/g, "a").replace(/ee|ii|ie/g, "i").replace(/oo|uu|ou/g, "u");
  s = s.replace(/(.)\1+/g, "$1");
  // The vowel every consonant carries in the script is often silent at the end of a word ("ताज" is "Taj", not "Taja"); spellings
  // differ on it, so it is dropped on both sides.
  if (s.length >= 4 && s.endsWith("a")) s = s.slice(0, -1);
  return s;
}
/** The consonants only ("mysore" and "mysuru" are both "mysr"). */
const skeleton = (w: string) => w[0] + w.slice(1).replace(/[aeiouy]/g, "");

const tokens = (s: string): string[] =>
  romanize(s.normalize("NFKC")).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

/** Words that are not part of a place's own name. */
const FILLER = new Set(["the", "of", "and", "at", "in", "near", "a", "sri", "shri", "shree", "sree", "srimad", "swamy", "swami", "svami", "svamy", "devasthanam", "devastanam", "temple's", "ji", "sahib", "saheb", "mata", "maa"]);
/** Kinds of place, with the words people use for each. Two names of different kinds are different places. */
const KIND_OF: Record<string, string> = {};
for (const [kind, words] of Object.entries({
  temple: "temple temples mandir mandiram kovil koil gudi devalayam devalaya alayam shrine math mutt",
  mosque: "mosque masjid dargah",
  church: "church cathedral basilica chapel",
  gurdwara: "gurdwara gurudwara",
  monastery: "monastery gompa vihara",
  fort: "fort fortress qila killa kila kota durg garh",
  palace: "palace mahal",
  beach: "beach",
  lake: "lake sagar sarovar tal talab",
  dam: "dam barrage reservoir",
  falls: "falls waterfall waterfalls jalapatham",
  cave: "cave caves guha",
  museum: "museum",
  park: "park garden udyan",
  zoo: "zoo",
  sanctuary: "sanctuary",
  hill: "hill hills peak",
  tomb: "tomb maqbara mausoleum",
  stepwell: "stepwell baoli vav",
})) for (const w of words.split(" ")) KIND_OF[w] = kind;
/** A facility named after a place is not the place. */
const FACILITY = new Set(["hotel", "restaurant", "cafe", "dhaba", "bar", "lodge", "residency", "inn", "resort", "guest", "hostel", "station", "metro", "railway", "bus", "stop", "depot",
  "terminal", "junction", "road", "rd", "marg", "street", "lane", "colony", "nagar", "hospital", "clinic", "school", "college", "university", "bank", "atm", "shop", "store", "mall",
  "parking", "office", "police", "post", "pump", "petrol", "apartment", "apartments", "towers", "enclave", "layout", "stores", "sweets", "bakery", "travels", "tours"]);

// The same word lists by their folded spelling, so a romanized "mahala" or "mandira" is still recognised.
const FILLER_F = new Set([...FILLER].map(foldWord));
const FACILITY_F = new Set([...FACILITY].map(foldWord));
const KIND_F: Record<string, string> = Object.fromEntries(Object.entries(KIND_OF).map(([w, k]) => [foldWord(w), k]));

type Parsed = { words: string[]; kinds: Set<string>; facility: boolean };
function parse(name: string): Parsed {
  const words: string[] = [], kinds = new Set<string>();
  let facility = false;
  for (const t of tokens(name)) {
    const f = foldWord(t);
    if (FILLER.has(t) || FILLER_F.has(f)) continue;
    if (FACILITY.has(t) || FACILITY_F.has(f)) { facility = true; continue; }
    const k = KIND_OF[t] ?? KIND_F[f];
    if (k) { kinds.add(k); continue; }
    words.push(f);
  }
  return { words, kinds, facility };
}

/** Within `max` edits (Levenshtein). */
function edits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}
/** Two (folded) words are one word spelled two ways. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || a[0] !== b[0]) return false;
  if (edits(a, b, Math.min(a.length, b.length) >= 8 ? 2 : 1)) return true;
  const sa = skeleton(a), sb = skeleton(b);
  return sa.length >= 3 && sa === sb;
}

/** 0..1: how surely two names name the same place (names only). */
function scoreOne(a: Parsed, b: Parsed): number {
  if (a.facility !== b.facility) return 0;                                                  // "Taj Mahal" vs "Taj Mahal Palace Hotel"
  if (a.kinds.size && b.kinds.size && ![...a.kinds].some((k) => b.kinds.has(k))) return 0;   // temple vs beach, fort vs dam
  if (!a.words.length || !b.words.length) return a.words.length === b.words.length && a.kinds.size && b.kinds.size ? 0.6 : 0;
  const [short, long] = a.words.length <= b.words.length ? [a.words, b.words] : [b.words, a.words];
  const used = new Set<number>();
  let hit = 0;
  for (const w of short) {
    const j = long.findIndex((x, i) => !used.has(i) && sameWord(w, x));
    if (j >= 0) { used.add(j); hit++; }
  }
  if (hit === short.length) {
    if (short.length === long.length) return a.words.join(" ") === b.words.join(" ") ? 1 : 0.95;
    return 0.85;                                                                               // "Meenakshi Temple" in "Meenakshi Amman Temple"
  }
  return hit / new Set([...a.words, ...b.words]).size;
}

/** The names a place goes by: its name, a name in brackets and the name outside them, and any other names the data gives. */
export function nameVariants(name: string, aliases: readonly (string | null | undefined)[] = []): string[] {
  const out = new Set<string>();
  for (const n of [name, ...aliases]) {
    if (!n) continue;
    for (const part of n.split(/;/)) {                                                         // OpenStreetMap lists several names with ";"
      const t = part.trim();
      if (!t) continue;
      out.add(t);
      const m = /^(.*?)\s*\(([^)]+)\)\s*(.*)$/.exec(t);
      if (m) { out.add(`${m[1]} ${m[3]}`.trim()); out.add(m[2].trim()); }
    }
  }
  return [...out].filter((x) => x.length >= 2);
}

/** 0..1: the best match between any name of A and any name of B. */
export function samePlaceScore(a: string, b: string, opts: { aliasesA?: readonly (string | null | undefined)[]; aliasesB?: readonly (string | null | undefined)[] } = {}): number {
  let best = 0;
  const pa = nameVariants(a, opts.aliasesA).map(parse), pb = nameVariants(b, opts.aliasesB).map(parse);
  for (const x of pa) for (const y of pb) { best = Math.max(best, scoreOne(x, y)); if (best === 1) return 1; }
  return Math.round(best * 100) / 100;
}

/** OpenStreetMap tags that carry other names of the same place. */
export const ALIAS_TAGS = ["alt_name", "old_name", "official_name", "short_name", "loc_name", "name:en", "int_name", "name:hi", "name:te", "name:ta", "name:kn", "name:ml", "name:mr", "name:bn", "name:gu", "name:pa", "name:or"] as const;
export const aliasesFromTags = (tags: Record<string, string> | null | undefined): string[] => (tags ? ALIAS_TAGS.map((k) => tags[k]).filter((v): v is string => !!v) : []);
