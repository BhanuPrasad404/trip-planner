import { distanceKm } from "@/lib/geo";
import { FAR_PIN_KM } from "@/lib/pin-check";
import { normalizeCategory, type PlaceCategory } from "@/lib/categories";
import { extractPlaces, suggestPlaces, type AiPlace, type ImageInput, type SuggestContext } from "@/lib/ai/extract";
import type { ToolCaller } from "@/lib/ai/anthropic";
import type { Geocoder } from "@/lib/geocode";
import { extractUrls, isGoogleMapsUrl, isShortMapsUrl, parseMapsUrl, stripUrls } from "@/lib/maps-url";
import { matchSeasonTag, nameSimilarity, type SeasonTagLite } from "@/lib/season-match";

export type CandidateSource = "maps_link" | "ai_text" | "screenshot" | "ai_suggestion";

export type ImportCandidate = {
  key: string;
  name: string;
  area: string | null;
  address: string | null;
  category: PlaceCategory;
  lat: number | null;
  lng: number | null;
  confidence: number;
  source: CandidateSource;
  note: string | null;
  sourceUrl: string | null;
  seasonTagId: string | null;
  seasonReason: string | null;
  seasonGoodMonths: number[] | null;
  warnings: string[];
  duplicate: boolean;
  /** Much further from where the trip is going than a normal stop — likely the wrong place. */
  far: boolean;
};

export type ImportDeps = {
  llm?: ToolCaller;
  geocode: Geocoder;
  resolveUrl: (url: string) => Promise<string | null>;
};

export type ImportInput = {
  mode: "extract" | "suggest";
  text: string;
  images: ImageInput[];
  bias?: { lat: number; lng: number } | null;
  /** Human name for the bias point (destination or start city), used in warnings. */
  biasLabel?: string | null;
  context?: SuggestContext;
  seasonTags: SeasonTagLite[];
  existing: { name: string; lat: number; lng: number }[];
};

const MAX_URLS = 10;
const DUP_KM = 0.3;
const FAR_KM = FAR_PIN_KM;

export async function runImport(input: ImportInput, deps: ImportDeps): Promise<{ candidates: ImportCandidate[]; notes: string[] }> {
  const notes: string[] = [];
  const raw: Omit<ImportCandidate, "key" | "seasonTagId" | "seasonReason" | "seasonGoodMonths" | "duplicate">[] = [];

  if (input.mode === "suggest") {
    if (!deps.llm) throw new Error("llm required");
    const ai = await suggestPlaces(input.text, input.context ?? { startCity: null, startDate: null, numDays: 3 }, deps.llm);
    if (ai.length === 0) notes.push("The AI couldn't come up with confident suggestions for that brief. Try adding more detail.");
    await geocodeAll(ai, "ai_suggestion", input.bias ?? null, input.biasLabel ?? null, deps, raw);
  } else {
    // 1) Deterministic path: Google Maps links carry exact coordinates.
    const urls = extractUrls(input.text).slice(0, MAX_URLS);
    const otherUrls: string[] = [];
    for (const url of urls) {
      if (!isGoogleMapsUrl(url)) {
        otherUrls.push(url);
        continue;
      }
      let pin = parseMapsUrl(url);
      if (!pin && isShortMapsUrl(url)) {
        const final = await deps.resolveUrl(url);
        pin = final ? parseMapsUrl(final) : null;
      }
      if (pin) {
        const kmFromTrip = input.bias ? distanceKm(input.bias, pin) : 0;
        const far = kmFromTrip > FAR_KM;
        raw.push({
          name: pin.name ?? "Pinned location",
          area: null,
          address: null,
          category: "other",
          lat: pin.lat,
          lng: pin.lng,
          confidence: 1,
          source: "maps_link",
          note: null,
          sourceUrl: url,
          far,
          warnings: [
            ...(pin.name ? [] : ["This link has no place name — rename it before adding."]),
            ...(far ? [`${Math.round(kmFromTrip)} km from ${input.biasLabel ?? "where your trip is going"} — the pin is exact, but check this is the stop you meant.`] : []),
          ],
        });
      } else {
        notes.push("Couldn't read a location from one of the Maps links.");
      }
    }

    // 2) AI path: captions, WhatsApp text, screenshots.
    const remaining = stripUrls(input.text);
    const hasSocialLink = otherUrls.some((u) => /instagram\.com|facebook\.com|fb\.watch|youtube\.com|youtu\.be|tiktok\.com/i.test(u));
    if (remaining.length >= 15 || input.images.length > 0) {
      if (!deps.llm) throw new Error("llm required");
      const ai = await extractPlaces({ text: remaining, images: input.images }, deps.llm);
      const source: CandidateSource = input.images.length > 0 && remaining.length < 15 ? "screenshot" : "ai_text";
      const link = otherUrls.length === 1 ? otherUrls[0] : null;
      await geocodeAll(ai, source, input.bias ?? null, input.biasLabel ?? null, deps, raw, link);
      if (ai.length === 0) notes.push("No places found in that text. Paste the full caption or try a screenshot.");
    } else if (hasSocialLink && raw.length === 0) {
      notes.push("Social apps block automatic link reading. Paste the caption text or upload a screenshot of the reel instead.");
    }
  }

  // 3) Clean up: dedupe within the batch, flag duplicates of places already on the trip, match season data.
  const deduped: typeof raw = [];
  for (const c of raw) {
    const dup = deduped.find(
      (d) =>
        nameSimilarity(d.name, c.name) >= 0.85 ||
        (d.lat != null && c.lat != null && d.lng != null && c.lng != null && distanceKm({ lat: d.lat, lng: d.lng }, { lat: c.lat, lng: c.lng }) < DUP_KM)
    );
    if (!dup) deduped.push(c);
    else if (c.confidence > dup.confidence) Object.assign(dup, c);
  }

  const candidates: ImportCandidate[] = deduped.map((c, i) => {
    const tag = matchSeasonTag({ name: c.name, lat: c.lat, lng: c.lng }, input.seasonTags);
    const duplicate = input.existing.some(
      (e) => nameSimilarity(e.name, c.name) >= 0.85 || (c.lat != null && c.lng != null && distanceKm(e, { lat: c.lat, lng: c.lng }) < DUP_KM)
    );
    const warnings = [...c.warnings];
    if (duplicate) warnings.push("Already on this trip.");
    return {
      ...c,
      category: tag?.category ? normalizeCategory(tag.category) : c.category,
      key: `${i}-${c.name}`,
      seasonTagId: tag?.id ?? null,
      seasonReason: tag?.reason ?? null,
      seasonGoodMonths: tag?.good_months ?? null,
      duplicate,
      warnings,
    };
  });

  return { candidates, notes };
}

async function geocodeAll(
  ai: AiPlace[],
  source: CandidateSource,
  bias: { lat: number; lng: number } | null,
  biasLabel: string | null,
  deps: ImportDeps,
  out: Array<Omit<ImportCandidate, "key" | "seasonTagId" | "seasonReason" | "seasonGoodMonths" | "duplicate">>,
  sourceUrl: string | null = null
) {
  for (const p of ai) {
    const query = p.area ? `${p.name}, ${p.area}` : p.name;
    let geo = await deps.geocode(query, bias ?? undefined);
    if (!geo && p.area) geo = await deps.geocode(p.name, bias ?? undefined);

    const warnings: string[] = [];
    if (!geo) warnings.push("Couldn't find this on the map — it can't be added until located.");
    let far = false;
    if (geo && bias) {
      const km = distanceKm(bias, geo);
      if (km > FAR_KM) {
        far = true;
        warnings.push(`${Math.round(km)} km from ${biasLabel ?? "where your trip is going"} — check it's the right place.`);
      }
    }
    if (source === "ai_suggestion") warnings.push("AI suggestion — double-check before you commit.");

    out.push({
      name: p.name,
      area: p.area,
      address: geo?.address || null,
      category: normalizeCategory(p.kind),
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      confidence: geo ? Math.min(p.confidence, geo.confidence) : Math.min(p.confidence, 0.3),
      source,
      note: p.note,
      sourceUrl,
      warnings,
      far,
    });
  }
}
