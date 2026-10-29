// The 28 states and 8 union territories of India, by ISO 3166-2 code. This is the SCOPE of discovery (like a map's borders), not a list
// of destinations: every place shown inside a region is looked up live. OpenStreetMap tags some regions with an older code, so each
// entry lists every code worth matching.
export type Region = { code: string; name: string; kind: "state" | "ut"; /** ISO 3166-2 suffixes OpenStreetMap may use for this region (current code first). */ iso: string[] };

export const REGIONS: readonly Region[] = [
  { code: "AN", name: "Andaman and Nicobar Islands", kind: "ut", iso: ["AN"] },
  { code: "AP", name: "Andhra Pradesh", kind: "state", iso: ["AP"] },
  { code: "AR", name: "Arunachal Pradesh", kind: "state", iso: ["AR"] },
  { code: "AS", name: "Assam", kind: "state", iso: ["AS"] },
  { code: "BR", name: "Bihar", kind: "state", iso: ["BR"] },
  { code: "CH", name: "Chandigarh", kind: "ut", iso: ["CH"] },
  { code: "CT", name: "Chhattisgarh", kind: "state", iso: ["CT", "CG"] },
  { code: "DH", name: "Dadra and Nagar Haveli and Daman and Diu", kind: "ut", iso: ["DH", "DD", "DN"] },
  { code: "DL", name: "Delhi", kind: "ut", iso: ["DL"] },
  { code: "GA", name: "Goa", kind: "state", iso: ["GA"] },
  { code: "GJ", name: "Gujarat", kind: "state", iso: ["GJ"] },
  { code: "HP", name: "Himachal Pradesh", kind: "state", iso: ["HP"] },
  { code: "HR", name: "Haryana", kind: "state", iso: ["HR"] },
  { code: "JH", name: "Jharkhand", kind: "state", iso: ["JH"] },
  { code: "JK", name: "Jammu and Kashmir", kind: "ut", iso: ["JK"] },
  { code: "KA", name: "Karnataka", kind: "state", iso: ["KA"] },
  { code: "KL", name: "Kerala", kind: "state", iso: ["KL"] },
  { code: "LA", name: "Ladakh", kind: "ut", iso: ["LA"] },
  { code: "LD", name: "Lakshadweep", kind: "ut", iso: ["LD"] },
  { code: "MH", name: "Maharashtra", kind: "state", iso: ["MH"] },
  { code: "ML", name: "Meghalaya", kind: "state", iso: ["ML"] },
  { code: "MN", name: "Manipur", kind: "state", iso: ["MN"] },
  { code: "MP", name: "Madhya Pradesh", kind: "state", iso: ["MP"] },
  { code: "MZ", name: "Mizoram", kind: "state", iso: ["MZ"] },
  { code: "NL", name: "Nagaland", kind: "state", iso: ["NL"] },
  { code: "OD", name: "Odisha", kind: "state", iso: ["OD", "OR"] },
  { code: "PB", name: "Punjab", kind: "state", iso: ["PB"] },
  { code: "PY", name: "Puducherry", kind: "ut", iso: ["PY"] },
  { code: "RJ", name: "Rajasthan", kind: "state", iso: ["RJ"] },
  { code: "SK", name: "Sikkim", kind: "state", iso: ["SK"] },
  { code: "TG", name: "Telangana", kind: "state", iso: ["TG", "TS"] }, // OpenStreetMap uses the newer IN-TS
  { code: "TN", name: "Tamil Nadu", kind: "state", iso: ["TN"] },
  { code: "TR", name: "Tripura", kind: "state", iso: ["TR"] },
  { code: "UP", name: "Uttar Pradesh", kind: "state", iso: ["UP"] },
  { code: "UT", name: "Uttarakhand", kind: "state", iso: ["UT", "UK"] },
  { code: "WB", name: "West Bengal", kind: "state", iso: ["WB"] },
];

export const REGION_CODES = REGIONS.map((r) => r.code) as [string, ...string[]];
export const regionByCode = (code: string): Region | null => REGIONS.find((r) => r.code === code) ?? null;
