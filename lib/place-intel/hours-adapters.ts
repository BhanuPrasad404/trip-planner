// Curated hours sources: an adapter reads ONE specific source whose reuse is clearly permitted, and every entry it gives was checked by a
// person (who, when, from which page). None is set up: the list is EMPTY ON PURPOSE. Official websites are shown as links, never read
// or scraped; a paid source would be added here as another adapter, never mixed into the free ones.
export type CuratedHours = {
  /** Adapter id. */
  adapter: string;
  /** The source's name as shown to travellers. */
  name: string;
  /** Exactly as the source writes it (opening_hours syntax), never retyped from memory. */
  schedule: string;
  /** The page it was read from. */
  sourceUrl: string;
  /** YYYY-MM-DD the page was read. */
  readOn: string;
  /** Who checked the entry against the page. */
  verifiedBy: string;
};
export type CuratedLookup = { name: string; lat: number; lng: number; wikidata?: string | null; osm?: string | null };
export type CuratedHoursAdapter = {
  id: string;
  /** Licence or permission that allows reuse, with a link. Required. */
  licence: string;
  lookup: (place: CuratedLookup) => Promise<CuratedHours | null>;
};

export const CURATED_ADAPTERS: readonly CuratedHoursAdapter[] = [];

/** Every adapter's answer for a place (a failing adapter is skipped and said in the log, never fatal). */
export async function curatedHoursFor(place: CuratedLookup, adapters: readonly CuratedHoursAdapter[] = CURATED_ADAPTERS): Promise<CuratedHours[]> {
  const out: CuratedHours[] = [];
  for (const a of adapters) {
    try { const h = await a.lookup(place); if (h && /^\d{4}-\d{2}-\d{2}$/.test(h.readOn) && /^https?:\/\//.test(h.sourceUrl) && h.verifiedBy.trim()) out.push(h); }
    catch (e) { console.error(`[hours] curated adapter ${a.id}:`, e instanceof Error ? e.message : e); }
  }
  return out;
}
