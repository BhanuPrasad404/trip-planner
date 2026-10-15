import type { GeoPoint } from "@/lib/geo";

/** How the place's Wikipedia article was found. "exact" (title or redirect) is the most reliable. */
export type FoundVia = "exact" | "search" | "geosearch" | "commons";

export type PlacePhoto = {
  /** Best single size (used when the browser ignores srcset). */
  url: string;
  /** The same file at the standard thumbnail widths, so a 64 px box does not download 500 px. */
  srcSet?: string;
  width: number; height: number; title: string;
  /** The Wikipedia article this photo came from (for a Commons-sourced photo: its Commons file page). */
  pageUrl: string;
  /** "wikipedia": the article's own image. "commons": a Commons photo matched to the place by name and geotag. */
  source: "wikipedia" | "commons";
  /** Commons file page: shows the full author and licence text. */
  creditUrl?: string;
  /** Plain-text author, or null when Commons does not say. */
  author?: string | null;
  /** Short licence name, e.g. "CC BY-SA 4.0". Present on every photo the resolver returns. */
  licence?: string;
  licenceUrl?: string | null;
  /** Commons file name and Wikidata item, kept as stable identity for the shared cache. */
  file?: string;
  wikidata?: string | null;
  via?: FoundVia;
};
export type PlacePhotoQuery = { key: string; name: string } & GeoPoint;

/** Why a place has no photo. Shown only in diagnostics, never to travellers. */
export type NoPhotoReason = "no_page" | "far" | "disambiguation" | "no_image" | "image_rejected" | "licence";
