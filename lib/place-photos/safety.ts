// The gates a photo must pass before TrailMate shows it as "a photo of this place". Pure functions, no network.
//
// Why these exist (see docs/UPDATE_57_CHANGELOG.md):
//  - upload.wikimedia.org also serves non-free images uploaded locally to ONE Wikipedia (/wikipedia/en/...). Only the shared
//    Commons repository (/wikipedia/commons/...) is restricted to freely licensed files, so that is the only path we accept.
//  - A village's lead image is very often a locator map, a flag or a coat of arms. That is not "a photo of the place".
//  - A free licence still needs credit (CC BY / CC BY-SA require author + licence), so we keep both and only show files whose
//    licence we have verified.

/** Widths Wikimedia pre-renders as thumbnails. NOT verified against the live service yet (see docs); one place to change it. */
export const THUMB_WIDTHS = [120, 250, 330, 500] as const;

const RASTER = /^(jpe?g|png|webp)$/i;
const HASH1 = /^[0-9a-f]$/;
const HASH2 = /^[0-9a-f]{2}$/;

export type CommonsUrl = {
  /** Original file name, still percent-encoded exactly as in the URL (safe to rebuild URLs from). */
  rawFile: string;
  /** Decoded file name, e.g. "Kondapalli Fort.jpg" (underscores kept as given). */
  file: string;
  /** Pixel width of this thumbnail, or null for the original file. */
  width: number | null;
  hash1: string;
  hash2: string;
};

/**
 * Accepts only https://upload.wikimedia.org/wikipedia/commons/… raster images, either an original
 * (/wikipedia/commons/a/ab/File.jpg) or a pre-sized thumbnail (/wikipedia/commons/thumb/a/ab/File.jpg/330px-File.jpg).
 * Everything else — other hosts, http, ports/credentials, other wikis (/wikipedia/en/), svg/tif/pdf — returns null.
 */
export function parseCommonsUrl(raw: string): CommonsUrl | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "upload.wikimedia.org" || u.port !== "" || u.username || u.password) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] !== "wikipedia" || parts[1] !== "commons") return null;
  let rest = parts.slice(2);
  let width: number | null = null;
  if (rest[0] === "thumb") {
    rest = rest.slice(1);
    if (rest.length !== 4) return null;
    const m = /^(\d{1,5})px-(.+)$/.exec(rest[3]);
    if (!m || m[2] === "" ) return null;
    width = Number(m[1]);
    rest = rest.slice(0, 3);
  }
  if (rest.length !== 3 || !HASH1.test(rest[0]) || !HASH2.test(rest[1]) || !rest[1].startsWith(rest[0])) return null;
  const rawFile = rest[2];
  let file: string;
  try { file = decodeURIComponent(rawFile); } catch { return null; }
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".") + 1) : "";
  if (!RASTER.test(ext) || file.length > 240) return null;
  return { rawFile, file, width, hash1: rest[0], hash2: rest[1] };
}

// Words that, in a file name, say "this is a drawing/symbol/map, not a photograph of the place".
const NOT_A_PHOTO = new Set([
  "map", "maps", "mapa", "locator", "flag", "flags", "seal", "emblem", "logo", "logos", "diagram", "chart", "icon", "icons",
  "symbol", "crest", "insignia", "pictogram", "schematic", "blank", "stamp", "banner", "signature", "coat", "arms", "plan", "layout",
]);

/** True when the file name says it is a map, flag, seal, logo, diagram… A name that says nothing passes (we can't tell). */
export function looksNotAPhoto(file: string): boolean {
  const base = file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file;
  const tokens = base.normalize("NFKD").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return tokens.some((t) => NOT_A_PHOTO.has(t));
}

/** One single licence name (no alternatives) that we accept: CC BY, CC BY-SA, CC0, public domain. NC/ND/GFDL-only are never accepted. */
function isSingleFreeLicence(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length > 60) return false;
  return /^cc[ -]by(?:[ -]sa)?[ -]\d(?:\.\d)?(?:[ -][a-z]{2,5})?$/i.test(s) || /^cc0\b/i.test(s) || /^cc[ -]zero\b/i.test(s)
    || /^public domain\b/i.test(s) || /^pd[ -]/i.test(s) || /^pdm\b/i.test(s) || /^no restrictions\b/i.test(s);
}

/**
 * The licence we will show, or null. Commons often states ALTERNATIVES the re-user may choose from ("CC BY-SA 3.0, GFDL",
 * "CC BY-SA 3.0, 2.5, 2.0, 1.0", "GFDL 1.2 or later / CC BY-SA 3.0"): one acceptable alternative is enough, and that one is the
 * licence we credit. "and" is deliberately NOT a separator: "X and Y" means both apply, so one acceptable half proves nothing.
 * Deliberately narrow otherwise: NC/ND variants, GFDL-only, "fair use" and anything we can't read are not accepted: a missing
 * photo costs nothing, a wrongly licensed one does.
 */
export function freeLicenceName(shortName: string | null | undefined): string | null {
  const s = (shortName ?? "").trim();
  if (!s || s.length > 120) return null;
  for (const part of s.split(/\s*(?:,|;|\/|\bor\b)\s*/i)) if (isSingleFreeLicence(part)) return part.trim();
  return null;
}

export const isFreeLicence = (shortName: string | null | undefined): boolean => freeLicenceName(shortName) !== null;

/** Commons also gives a machine-readable licence code ("cc-by-sa-4.0", "cc-zero", "pd"). A second opinion when the display name is odd. */
export function licenceFromCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toLowerCase();
  if (!c || c.length > 60) return null;
  const m = /^cc-by(-sa)?-(\d(?:\.\d)?)(?:-[a-z]{2,5})?$/.exec(c);
  if (m) return `CC BY${m[1] ? "-SA" : ""} ${m[2]}`;
  if (c === "cc-zero" || c === "cc0" || /^cc0-/.test(c)) return "CC0";
  if (c === "pd" || /^pd-/.test(c) || c === "public domain") return "Public domain";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Commons "Artist" values are HTML. Returns short plain text (React escapes it again on render) or null. */
export function sanitizeCredit(html: unknown, max = 80): string | null {
  if (typeof html !== "string") return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? " ";
    })
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Licence links are only kept when they point at the licence text itself (Creative Commons). */
export function safeLicenceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    return u.protocol === "https:" && (u.hostname === "creativecommons.org" || u.hostname === "www.creativecommons.org") ? u.toString() : null;
  } catch { return null; }
}

/** The one place the Commons file-page URL is built, so it can never point anywhere else. */
export const commonsFilePage = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;

/** "Photo: Jane Doe, CC BY-SA 4.0" (author unknown → "Wikimedia Commons"). */
export function creditText(p: { author?: string | null; licence?: string | null }): string {
  return `Photo: ${p.author || "Wikimedia Commons"}${p.licence ? `, ${p.licence}` : ""}`;
}

export type ThumbSet = { src: string; srcSet: string | null };

/**
 * From one delivered Commons thumbnail, the same file at the standard widths that are NOT larger than it (Wikimedia refuses to
 * upscale). Returns null when the URL is not an accepted Commons URL, so callers drop the photo instead of guessing.
 */
export function thumbSet(raw: string): ThumbSet | null {
  const c = parseCommonsUrl(raw);
  if (!c) return null;
  if (c.width === null) return { src: raw, srcSet: null }; // an original: we do not know its size, so do not invent thumbnail URLs
  const widths = THUMB_WIDTHS.filter((w) => w <= (c.width as number));
  if (widths.length === 0) return { src: raw, srcSet: null };
  const at = (w: number) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${c.hash1}/${c.hash2}/${c.rawFile}/${w}px-${c.rawFile}`;
  const src = at(widths.includes(330) ? 330 : widths[widths.length - 1]);
  return { src, srcSet: widths.map((w) => `${at(w)} ${w}w`).join(", ") };
}

export type ImageAddress = { url: string; width: number; height: number };

/**
 * A usable picture address from what Commons' imageinfo said. Commons does not always return a `thumburl` we can use (large
 * originals are the usual case), but it always returns the ORIGINAL file address, and the standard Wikimedia thumbnail address is
 * derived from that: /thumb/<h1>/<h2>/<file>/<w>px-<file>. Order of preference:
 *   1. the thumburl Commons gave, when it passes our Commons-only gate;
 *   2. a thumbnail derived from the original, at `wantWidth` (never wider than the original: Wikimedia will not upscale);
 *   3. the original itself, when it is not wider than `wantWidth` (already small enough).
 * Returns null when no accepted Commons address can be made: the photo is then dropped, never guessed.
 */
export function imageAddress(info: { thumburl?: string; thumbwidth?: number; thumbheight?: number; url?: string; width?: number; height?: number }, wantWidth = 500): ImageAddress | null {
  const ratio = info.width && info.height ? info.height / info.width : 0.66;
  if (info.thumburl && parseCommonsUrl(info.thumburl)) {
    const w = info.thumbwidth ?? Math.min(info.width ?? wantWidth, wantWidth);
    return { url: info.thumburl, width: w, height: info.thumbheight ?? Math.round(w * ratio) };
  }
  const orig = info.url ? parseCommonsUrl(info.url) : null;
  if (!orig || orig.width !== null || !info.width) return null; // we need the original's width to know what may be asked for
  if (info.width <= wantWidth) return { url: info.url as string, width: info.width, height: info.height ?? Math.round(info.width * ratio) };
  return {
    url: `https://upload.wikimedia.org/wikipedia/commons/thumb/${orig.hash1}/${orig.hash2}/${orig.rawFile}/${wantWidth}px-${orig.rawFile}`,
    width: wantWidth, height: Math.round(wantWidth * ratio),
  };
}
