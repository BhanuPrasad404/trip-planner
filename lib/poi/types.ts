// Our own place model. Providers give raw tags; we classify them once at ingestion and store clean rows.
import type { PoiGroup } from "@/lib/providers/types";

export const POI_KINDS = ["fuel", "ev", "food", "cafe", "restroom", "pharmacy", "hospital", "atm", "repair", "stay", "viewpoint", "sight", "parking"] as const;
export type PoiKind = (typeof POI_KINDS)[number];

export const KIND_META: Record<PoiKind, { label: string; group: PoiGroup }> = {
  fuel: { label: "Fuel", group: "essentials" },
  ev: { label: "EV charging", group: "essentials" },
  food: { label: "Food", group: "essentials" },
  cafe: { label: "Cafe", group: "essentials" },
  restroom: { label: "Restroom", group: "essentials" },
  pharmacy: { label: "Pharmacy", group: "essentials" },
  hospital: { label: "Hospital", group: "essentials" },
  atm: { label: "ATM / bank", group: "essentials" },
  repair: { label: "Vehicle repair", group: "essentials" },
  stay: { label: "Stay", group: "stay" },
  viewpoint: { label: "Viewpoint", group: "sights" },
  sight: { label: "Sight", group: "sights" },
  parking: { label: "Parking", group: "parking" },
};

export const kindsOfGroup = (g: PoiGroup): PoiKind[] => POI_KINDS.filter((k) => KIND_META[k].group === g);
export const groupsOfKinds = (kinds: PoiKind[]): PoiGroup[] => [...new Set(kinds.map((k) => KIND_META[k].group))];

/** A stored place. `source` says which provider the row came from (so providers can coexist). */
export type PoiRecord = {
  source: string;
  source_id: string;
  kind: PoiKind;
  name: string | null;
  lat: number;
  lng: number;
  tags: Record<string, string>;
  fetched_at: string;
};

export type LngLat = [number, number];
