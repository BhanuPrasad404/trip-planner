// One place that decides which vector icon stands for what (fuel, hospital, waterfall, ...).
// Icons come from Lucide (ISC licence, free for commercial use). Only the icons imported here are bundled.
// Pure data: safe on the server, in React components and in the MapLibre marker code.
import {
  Ban, Binoculars, Camera, Castle, Check, CircleCheck, Circle, Coffee, Construction, Droplets, FerrisWheel, Footprints, Frown, Fuel,
  Hospital, Landmark, Laugh, Leaf, Library, Lightbulb, LocateFixed, MapPin, Meh, Mountain, Navigation, PawPrint, Pill, Play, PlugZap,
  Route, Smile, Sparkles, Square, SquareParking, Sun, SunDim, Sunrise, Sunset, ThumbsDown, ThumbsUp, Toilet, TriangleAlert, Info,
  Umbrella, UtensilsCrossed, Users, Waves, BedDouble, Wrench, X, Angry, Car, ChevronDown, ChevronUp, ArrowRight,
  ArrowUp, CornerUpLeft, CornerUpRight, Undo2, RotateCw, Flag, Volume2, VolumeX, Moon, Layers,
} from "lucide";
import type { IconNode } from "lucide";

export const GLYPHS = {
  // places along the road
  fuel: Fuel, ev: PlugZap, food: UtensilsCrossed, cafe: Coffee, restroom: Toilet, pharmacy: Pill, hospital: Hospital,
  atm: Landmark, repair: Wrench, stay: BedDouble, viewpoint: Binoculars, sight: Mountain, parking: SquareParking,
  // trip place categories
  waterfall: Droplets, trek: Footprints, fort: Castle, lake: Waves, beach: Umbrella, temple: Landmark, hill: Mountain,
  wildlife: PawPrint, activity: FerrisWheel, museum: Library, pin: MapPin,
  // community report tags
  crowded: Users, quiet: Leaf, roadGood: Route, roadBad: Construction, closed: Ban, dry: SunDim,
  // interface
  sparkles: Sparkles, idea: Lightbulb, thumbUp: ThumbsUp, thumbDown: ThumbsDown, check: Check, checkCircle: CircleCheck, circle: Circle,
  warn: TriangleAlert, info: Info, play: Play, stop: Square, locate: LocateFixed, camera: Camera, close: X, car: Car,
  sunset: Sunset, sunrise: Sunrise, sun: Sun, navigate: Navigation, down: ChevronDown, up: ChevronUp, arrow: ArrowRight,
  arrowUp: ArrowUp, turnLeft: CornerUpLeft, turnRight: CornerUpRight, uturn: Undo2, roundabout: RotateCw, flag: Flag, volumeOn: Volume2, volumeOff: VolumeX, moon: Moon, layers: Layers,
  faceAngry: Angry, faceSad: Frown, faceOkay: Meh, faceGood: Smile, faceGreat: Laugh,
} as const satisfies Record<string, IconNode>;

export type GlyphName = keyof typeof GLYPHS;

export type Tone = "amber" | "clay" | "teal" | "pine";
/** Tint of the round badge behind an icon: classes for HTML, hex for the map. */
export const TONES: Record<Tone, { cls: string; fg: string; bg: string }> = {
  amber: { cls: "bg-marigold-light text-[#7a4a00]", fg: "#7A4A00", bg: "#FBE9C8" },
  clay: { cls: "bg-clay-light text-clay-ink", fg: "#C1542C", bg: "#F6DDD2" },
  teal: { cls: "bg-teal-light text-teal-ink", fg: "#1C7C6D", bg: "#D6EEE9" },
  pine: { cls: "bg-sky text-pine", fg: "#0B3D3A", bg: "#E6F0F2" },
};

// --- mapping from the app's existing keys → icon + tone -------------------------------------------------------------
export const KIND_GLYPH: Record<string, { glyph: GlyphName; tone: Tone }> = {
  fuel: { glyph: "fuel", tone: "amber" }, ev: { glyph: "ev", tone: "teal" }, food: { glyph: "food", tone: "clay" },
  cafe: { glyph: "cafe", tone: "clay" }, restroom: { glyph: "restroom", tone: "pine" }, pharmacy: { glyph: "pharmacy", tone: "teal" },
  hospital: { glyph: "hospital", tone: "clay" }, atm: { glyph: "atm", tone: "pine" }, repair: { glyph: "repair", tone: "amber" },
  stay: { glyph: "stay", tone: "pine" }, viewpoint: { glyph: "viewpoint", tone: "teal" }, sight: { glyph: "sight", tone: "teal" },
  sights: { glyph: "sight", tone: "teal" }, parking: { glyph: "parking", tone: "pine" },
};

export const CATEGORY_GLYPH: Record<string, { glyph: GlyphName; tone: Tone }> = {
  waterfall: { glyph: "waterfall", tone: "teal" }, trek: { glyph: "trek", tone: "amber" }, fort: { glyph: "fort", tone: "clay" },
  lake: { glyph: "lake", tone: "teal" }, beach: { glyph: "beach", tone: "amber" }, temple: { glyph: "temple", tone: "clay" },
  viewpoint: { glyph: "viewpoint", tone: "teal" }, hill_station: { glyph: "hill", tone: "teal" }, wildlife: { glyph: "wildlife", tone: "amber" },
  activity: { glyph: "activity", tone: "clay" }, museum: { glyph: "museum", tone: "pine" }, food: { glyph: "food", tone: "clay" },
  stay: { glyph: "stay", tone: "pine" }, other: { glyph: "pin", tone: "pine" },
};

export const REPORT_TAG_GLYPH: Record<string, GlyphName> = {
  water_flowing: "waterfall", dry: "dry", crowded: "crowded", quiet: "quiet", road_good: "roadGood", road_bad: "roadBad",
  closed: "closed", great_view: "viewpoint", muddy: "trek",
};
