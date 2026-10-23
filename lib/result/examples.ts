// Ready-made example plans for new visitors: REAL places and a real plan, made by scripts/build-examples.ts with live free data (OSRM
// roads, Open-Meteo heights, GeoNames towns) on the date written in each file. A visitor sees a result before signing up; signing up is
// only asked at "Save this trip". Nothing here is invented: re-run the script to refresh them.
import chennai from "@/data/examples/chennai-puducherry.json";
import kochi from "@/data/examples/kochi-munnar-alleppey.json";
import type { ResultData } from "./model";

export type ExamplePlan = {
  slug: string;
  title: string;
  blurb: string;
  built: string;
  days: number;
  endMode: "start" | "place" | "open";
  /** The guided-flow answers this example was planned with (saved with the trip when the visitor saves it). */
  intake: Record<string, unknown>;
  places: { name: string; lat: number; lng: number; category: string; area: string }[];
  data: ResultData;
  /** Road lines per plan style, per day ([lng, lat] points), fetched when the example was built. */
  lines: Record<string, Record<string, [number, number][]>>;
};

export const EXAMPLES: ExamplePlan[] = [chennai as unknown as ExamplePlan, kochi as unknown as ExamplePlan];
export const exampleBySlug = (slug: string) => EXAMPLES.find((e) => e.slug === slug) ?? null;
