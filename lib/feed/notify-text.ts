export type NotificationKind = "like" | "comment" | "reply" | "helpful" | "trip_add";

/** The sentence a notification reads as. Someone without a profile is "A traveler", never a blank. */
export function notificationText(n: { kind: NotificationKind; actor: string | null; destination: string | null }): string {
  const who = n.actor ? `@${n.actor}` : "A traveler";
  const where = n.destination ? ` in ${n.destination}` : "";
  switch (n.kind) {
    case "like": return `${who} liked your post${where}`;
    case "comment": return `${who} commented on your post${where}`;
    case "reply": return `${who} replied to your comment${where}`;
    case "helpful": return `${who} found your post${where} helpful`;
    // Planning is private: the person is not named, only the effect.
    case "trip_add": return `A traveler added your post${where} to their trip`;
  }
}
