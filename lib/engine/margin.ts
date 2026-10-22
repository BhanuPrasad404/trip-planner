// The stated road-time margin (rules.ts): +15% on every drive, +30% on hill drives. Applied to the raw routing times BEFORE planning,
// so every number the traveller sees already includes it (and the plan says so).
import { HILL_BOTH_ABOVE_M, HILL_MARGIN, HILL_RISE_M, ROAD_MARGIN } from "./rules";
import type { RoadLine } from "./types";

type Matrix = { durations: number[][]; distances: number[][]; source: string; estimatedPairs?: number };

/** Is the drive between two heights a hill drive? Unknown heights never count as hill (no guess). */
export function isHillPair(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) >= HILL_RISE_M || (a >= HILL_BOTH_ABOVE_M && b >= HILL_BOTH_ABOVE_M);
}

/** The matrix with the margin added; also which pairs were treated as hill drives. Distances are unchanged. */
export function withMargin(m: Matrix, heights: (number | null)[] | null): { matrix: Matrix; hill: boolean[][] } {
  const n = m.durations.length;
  const hill = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i !== j && isHillPair(heights?.[i], heights?.[j])));
  const durations = m.durations.map((row, i) => row.map((s, j) => (i === j ? 0 : s * (1 + (hill[i][j] ? HILL_MARGIN : ROAD_MARGIN)))));
  return { matrix: { ...m, durations }, hill };
}

/** The same margin on a road line, piece by piece (hill pieces from real heights along the road). */
export function lineWithMargin(line: RoadLine): RoadLine {
  return { ...line, durations: line.durations.map((s, i) => s * (1 + (line.hill?.[i] ? HILL_MARGIN : ROAD_MARGIN))) };
}
