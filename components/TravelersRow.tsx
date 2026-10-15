import { safeColor } from "@/lib/format";

export type Traveler = { id: string; display_name: string | null; avatar_color: string | null };

/** A solo trip has nobody to tell apart, so the row would only be one initial taking up a line of the header. */
export const showTravelers = (members: readonly unknown[]): boolean => members.length > 1;

/**
 * Who is on this trip, as overlapping initials. Shown only when more than one person is on the trip.
 * (The account menu lives in the navigation; this row is about the group, not about you.)
 */
export function TravelersRow({ members }: { members: readonly Traveler[] }) {
  if (!showTravelers(members)) return null;
  return (
    <ul className="mt-3 flex items-center" aria-label={`Travelers (${members.length})`}>
      {members.map((m, i) => (
        <li
          key={m.id}
          title={m.display_name ?? "Traveler"}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white"
          style={{ backgroundColor: safeColor(m.avatar_color), marginLeft: i === 0 ? 0 : -8 }}
        >
          <span aria-hidden="true">{m.display_name?.[0]?.toUpperCase() ?? "?"}</span>
          <span className="sr-only">{m.display_name ?? "Traveler"}</span>
        </li>
      ))}
    </ul>
  );
}
