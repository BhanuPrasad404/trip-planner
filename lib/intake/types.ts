// What a traveller told us about the trip, and how sure we are of each piece. Shared by the server and the browser.

export type Group = "solo" | "couple" | "friends" | "family" | "family_kids" | "family_elders";
export type TravelMode = "car" | "bike" | "bus" | "train";
export type Pace = "relaxed" | "balanced" | "packed";
export type Interest = "nature" | "temples" | "food" | "adventure" | "photography" | "offbeat" | "shopping" | "beaches" | "history";
export type StayStyle = "hotel" | "homestay" | "hostel" | "camping" | "resort";
export type EndMode = "start" | "place" | "open";

export const GROUPS: Group[] = ["solo", "couple", "friends", "family", "family_kids", "family_elders"];
export const TRAVEL_MODES: TravelMode[] = ["car", "bike", "bus", "train"];
export const PACES: Pace[] = ["relaxed", "balanced", "packed"];
export const INTERESTS: Interest[] = ["nature", "temples", "food", "adventure", "photography", "offbeat", "shopping", "beaches", "history"];
export const STAY_STYLES: StayStyle[] = ["hotel", "homestay", "hostel", "camping", "resort"];

export const GROUP_LABEL: Record<Group, string> = { solo: "Solo", couple: "Couple", friends: "Friends", family: "Family", family_kids: "Family with kids", family_elders: "Family with elders" };
export const MODE_LABEL: Record<TravelMode, string> = { car: "Own car", bike: "Bike", bus: "Bus", train: "Train" };
export const PACE_LABEL: Record<Pace, string> = { relaxed: "Relaxed", balanced: "Balanced", packed: "Packed" };
export const INTEREST_LABEL: Record<Interest, string> = { nature: "Nature", temples: "Temples", food: "Food", adventure: "Adventure", photography: "Photography", offbeat: "Offbeat", shopping: "Shopping", beaches: "Beaches", history: "Forts & history" };
export const STAY_LABEL: Record<StayStyle, string> = { hotel: "Hotel", homestay: "Homestay", hostel: "Hostel", camping: "Camping", resort: "Resort" };

/** The simple answers (everything except places), as plain values. */
export type TripAnswers = {
  days?: number;
  month?: number;
  startSaid?: string;
  endSaid?: string;
  endMode?: EndMode;
  group?: Group;
  groupSize?: number;
  mode?: TravelMode;
  pace?: Pace;
  maxDriveHours?: number;
  nightDriving?: boolean;
  interests?: Interest[];
  stay?: StayStyle;
  avoid?: string[];
  /** The first day, when the traveller said it ("tomorrow", "this Saturday", "14 Nov"): "YYYY-MM-DD". */
  startDate?: string;
  /** When they leave on the first day, when said ("6 am", "after lunch"): "HH:MM", 24-hour. */
  startTime?: string;
};
export type AnswerKey = keyof TripAnswers;

/** Where a value came from. "said" = found in the words by our own reader; "ai" = read by the AI AND backed by words in the text. */
export type Source = "said" | "ai" | "default" | "you";

export type Known<T> = { value: T; source: Source; /** The traveller's own words that support it (empty for defaults). */ evidence: string };

/** A place name as the traveller wrote it, before it is found on the map. */
export type SaidPlace = { said: string; must: boolean; source: "said" | "ai"; evidence: string };

/** An AI reading we did NOT apply because nothing in the text supports it; the screen may offer it as "Use it?". */
export type Unbacked = { key: AnswerKey | "place"; value: unknown; why: string };

export type Understanding = {
  answers: { [K in AnswerKey]?: Known<NonNullable<TripAnswers[K]>> };
  places: SaidPlace[];
  /** Both readers found a value and they differ: the screen asks. */
  conflicts: { key: AnswerKey; said: unknown; ai: unknown }[];
  unbacked: Unbacked[];
  /** Scripts seen in the text ("Telugu", "Devanagari"…), for honesty in the UI and in tests. */
  scripts: string[];
};
