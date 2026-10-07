// The planner's public entry point: one call turns the traveller's places + the road matrix into a reality check, natural
// clusters, three (or more) complete plan options and clear suggestions. Pure and deterministic: same input → same output.
import { BUILDER_VERSION, DEFAULT_OPTION_STYLES, STYLES, type StyleId } from "./config";
import { findClusters } from "./clusters";
import { makeCtx } from "./model";
import { buildPlan } from "./plan";
import { realityFor, removeSuggestions } from "./reality";
import type { BuilderInput, BuilderResult } from "./types";

export * from "./types";
export { BUILDER_VERSION, MAX_BUILDER_PLACES, PRIORITIES, PRIORITY_LABEL, STYLES, DEFAULT_OPTION_STYLES } from "./config";
export type { Priority, StyleId } from "./config";
export { duration, hhmm } from "./model";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Plain statements about the input itself: likely duplicates, missing hours. Never changes the plan. */
export function inputNotes(input: BuilderInput): string[] {
  const notes: string[] = [];
  const seen = new Map<string, string>();
  for (const p of input.places) {
    const k = norm(p.name);
    if (k && seen.has(k)) notes.push(`"${p.name}" appears twice in your list.`);
    seen.set(k, p.id);
  }
  const dup = input.places.flatMap((a, i) => input.places.slice(i + 1).filter((b) => Math.abs(a.lat - b.lat) < 0.0025 && Math.abs(a.lng - b.lng) < 0.0025 && norm(a.name) !== norm(b.name)).map((b) => `"${a.name}" and "${b.name}" are within about 250 m of each other: are they the same place?`));
  notes.push(...dup);
  if (input.matrix.source === "estimate") notes.push("The routing service was unavailable, so distances and times are estimates.");
  else if ((input.matrix.estimatedPairs ?? 0) > 0) notes.push(`${input.matrix.estimatedPairs} place pair(s) have no road connection in our map data, so those distances are estimates.`);
  return notes;
}

export function buildTrip(input: BuilderInput, styles: StyleId[] = DEFAULT_OPTION_STYLES): BuilderResult {
  const ctx = makeCtx(input, STYLES.balanced);
  const clusters = findClusters(ctx);
  return {
    version: BUILDER_VERSION,
    routing: input.matrix.source,
    numDays: input.numDays,
    reality: realityFor(ctx, input.numDays),
    clusters: clusters.clusters,
    placeCosts: input.places.map((p, i) => ({
      placeId: p.id, clusterId: clusters.clusterOf.get(i + 1) ?? null, visitMin: ctx.visitMin(i + 1),
      fromStart: { dir: ctx.dir(0, i + 1), km: Math.round(ctx.km(0, i + 1)), driveMin: Math.round(ctx.driveMin(0, i + 1)) },
      totalMin: Math.round(ctx.driveMin(0, i + 1) + ctx.visitMin(i + 1) + ctx.bufferMin),
    })),
    options: styles.map((s) => buildPlan(input, s, { clusters })),
    removeSuggestions: removeSuggestions(ctx, input.numDays),
    notes: inputNotes(input),
  };
}
