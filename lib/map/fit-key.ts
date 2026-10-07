// "Has the CONTENT the map should frame really changed?" — compared by value, not by object identity. React hands us new
// objects on every render; re-framing the map each time made it snap back whenever the traveller zoomed out.
type P = { id: string; lat: number; lng: number; day: number | null; order: number | null };
type A = { lat: number; lng: number } | null;

const r = (n: number) => Math.round(n * 1e5) / 1e5;

export function contentKey(args: { places: P[]; start: A; destination: A; activeDay: number }): string {
  return JSON.stringify([
    args.activeDay,
    args.start && [r(args.start.lat), r(args.start.lng)],
    args.destination && [r(args.destination.lat), r(args.destination.lng)],
    args.places.map((p) => [p.id, r(p.lat), r(p.lng), p.day, p.order]),
  ]);
}

/** What should trigger re-framing: the content above plus the framing mode. */
export const fitKey = (args: Parameters<typeof contentKey>[0] & { fit: "day" | "all"; frameStartDest: boolean }) => `${args.fit}|${args.frameStartDest ? 1 : 0}|${contentKey(args)}`;
