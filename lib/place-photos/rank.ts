// Which of a page's candidate photos is the best picture OF THE PLACE? Pure and deterministic.
//
// Candidates come from three sources, in order of how much we trust them to depict the place:
//   lead     – the article's lead image (what Wikipedia itself shows first)
//   wikidata – the item's "image" statement (P18), chosen by editors to represent the entity
//   article  – other images used inside the article. These can show a king's portrait or a coin, so they are accepted ONLY when
//              the file name itself carries a distinctive word of the place's name ("Golconda_Fort_gate.jpg").
// Every candidate must also pass the hard gates: Commons raster, not a map/flag/logo by name, verified free licence.
import { identity } from "./match";
import type { FileMeta } from "./commons-meta";
import { fileKey } from "./commons-meta";
import { looksNotAPhoto, parseCommonsUrl } from "./safety";

export type CandidateSource = "lead" | "wikidata" | "article";
export type FileCandidate = { file: string; source: CandidateSource };
export type Ranked = { file: string; source: CandidateSource; meta: FileMeta; score: number };
/** Why nothing was chosen: no candidates at all, or every candidate failed (and the most telling reason). */
export type Rejection = "no_image" | "image_rejected" | "licence";

const BASE: Record<CandidateSource, number> = { lead: 5, wikidata: 4, article: 2 };
const MIN_WIDTH: Record<CandidateSource, number> = { lead: 300, wikidata: 300, article: 600 };

const tokens = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The place's distinctive words that also appear in the file name (e.g. "golconda"). */
export function sharesDistinctiveWord(placeName: string, file: string): boolean {
  const sig = identity(placeName).sig;
  if (sig.size === 0) return false;
  const inFile = new Set(tokens(file.replace(/\.[a-z0-9]+$/i, "")));
  return [...sig].some((w) => w.length >= 4 && inFile.has(w));
}

export function scoreFile(c: FileCandidate, meta: FileMeta, index: number): number {
  let score = BASE[c.source];
  const w = meta.width ?? meta.thumbWidth ?? 0;
  const h = meta.height ?? meta.thumbHeight ?? 0;
  const ratio = w > 0 && h > 0 ? w / h : 0;
  if (ratio >= 1.25 && ratio <= 2.2) score += 1.5; // landscape fits cards and banners; tall or square crops badly
  else if (ratio > 0 && ratio < 0.8) score -= 1;
  if (w >= 1200) score += 1;
  return score - index * 0.01; // earlier candidates win ties
}

type Verdict = { ok: true; meta: FileMeta } | { ok: false; why: string; licenceFailure?: boolean };

/** The ONE place a candidate file is judged. Both the real choice and the diagnostics use it, so they can never disagree. */
function judge(place: { name: string }, c: FileCandidate, info: Map<string, FileMeta | null>, whyNot?: Map<string, string>): Verdict {
  if (!/\.(jpe?g|png|webp)$/i.test(c.file)) return { ok: false, why: "not a jpg/png/webp photo" };
  if (looksNotAPhoto(c.file)) return { ok: false, why: "file name looks like a map, flag, logo or plan" };
  if (c.source === "article" && !sharesDistinctiveWord(place.name, c.file)) return { ok: false, why: "file name does not mention the place" };
  const key = fileKey(c.file);
  const meta = info.get(key);
  if (meta === null) return { ok: false, licenceFailure: true, why: whyNot?.get(key) ?? "not usable on Commons (not free, not on Commons, or unreadable)" };
  if (!meta) return { ok: false, why: "licence was never looked up" };
  if (!meta.thumbUrl || !parseCommonsUrl(meta.thumbUrl)) return { ok: false, why: "no usable Commons thumbnail address" };
  const w = meta.width ?? meta.thumbWidth ?? 0;
  if (w < MIN_WIDTH[c.source]) return { ok: false, why: `too small (${w}px wide, needs ${MIN_WIDTH[c.source]})` };
  return { ok: true, meta };
}

export function chooseBest(place: { name: string }, candidates: FileCandidate[], info: Map<string, FileMeta | null>): { best: Ranked } | { rejected: Rejection } {
  if (candidates.length === 0) return { rejected: "no_image" };
  let best: Ranked | null = null;
  let sawLicenceFailure = false;
  const seen = new Set<string>();
  candidates.forEach((c, i) => {
    const key = fileKey(c.file);
    if (seen.has(key)) return;
    seen.add(key);
    const v = judge(place, c, info);
    if (!v.ok) { if (v.licenceFailure) sawLicenceFailure = true; return; }
    const score = scoreFile(c, v.meta, i);
    if (!best || score > best.score) best = { file: c.file, source: c.source, meta: v.meta, score };
  });
  if (best) return { best };
  return { rejected: sawLicenceFailure ? "licence" : "image_rejected" };
}

/** One readable line per candidate: what it is and why it was (not) chosen. For the debug trail only. */
export function explainCandidates(place: { name: string }, candidates: FileCandidate[], info: Map<string, FileMeta | null>, whyNot?: Map<string, string>): string[] {
  if (candidates.length === 0) return ["no candidate image files at all (the article has no usable lead image, and nothing else qualified)"];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of candidates) {
    const key = fileKey(c.file);
    if (seen.has(key)) continue;
    seen.add(key);
    const v = judge(place, c, info, whyNot);
    lines.push(`${c.source} image "${c.file}": ${v.ok ? `OK (${v.meta.licence}${v.meta.width ? `, ${v.meta.width}px` : ""})` : `rejected: ${v.why}`}`);
  }
  return lines;
}
