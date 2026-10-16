export type SeasonRow = {
  place_name: string;
  lat: number;
  lng: number;
  category: string;
  good_months: number[];
  reason: string;
  region: string;
  confidence: string;
  source_urls: string[];
  last_checked: string;
};
export function buildSql(places: SeasonRow[]): string;
export const SEASON_FILE_RE: RegExp;
export function seasonMigrations(files: string[]): string[];
export function nextVersion(files: string[], now?: Date): string;
