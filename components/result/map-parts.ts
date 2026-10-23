// The plan map's light pieces (no MapLibre here, so the screen can use them without loading the map library).
export type MapDay = { day: number; coords: [number, number][] };
export type MapPin = { lat: number; lng: number; label: string; kind: "stop" | "halt" | "start" };
/** Each day's colour is a theme variable (app/globals.css): --tm-day-1 … --tm-day-6, then round again. */
export const dayColorVar = (day: number) => `--tm-day-${((day - 1) % 6) + 1}`;
