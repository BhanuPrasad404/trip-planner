// A trip with several people: each person's OWN journey, side by side, built only from what they themselves recorded. Pure.
//
// What is shared and what is not:
//   SHARED     the itinerary and a stop's status (done / skipped): marking a stop done is something the whole group sees. The screens say so.
//   INDIVIDUAL each person's journey (when they left, paused, rested), when THEY arrived at a place, and which stops THEY visited or skipped.
//              One person arriving never means the group has arrived; one person pausing never pauses anyone else.
// Nothing here uses a position. Where someone is on a map is a separate, opt-in choice (live location sharing), not part of this.
import { applyCorrections, deriveJourney, ordered, type JourneyEvent, type JourneyState } from "@/lib/trip/journey";

export type MemberLite = { user_id: string; display_name: string | null };
export type MemberProgress = {
  userId: string; name: string; you: boolean;
  state: JourneyState; since: string | null; departedAt: string | null;
  /** Where they said they arrived and have not finished or corrected. */
  atPlace: { placeId: string | null; name: string | null; arrivedAt: string } | null;
  visited: number; skipped: number;
  lastEventAt: string | null;
};

/** Each person's own picture. Members with no events are listed too ("hasn't set off"), never left out. */
export function memberProgress(events: JourneyEvent[], members: MemberLite[], me: string | null): MemberProgress[] {
  const fx = applyCorrections(events).events;
  return members.map((m) => {
    const own = events.filter((e) => e.userId === m.user_id);
    const journey = deriveJourney(own);
    const done = new Map<string, "done" | "skipped" | "planned">();
    for (const e of ordered(fx.filter((x) => x.userId === m.user_id && x.placeId))) {
      if (e.kind === "visit_completed") done.set(e.placeId!, "done");
      else if (e.kind === "visit_skipped") done.set(e.placeId!, "skipped");
      else if (e.kind === "visit_corrected") done.set(e.placeId!, "planned");
    }
    const vals = [...done.values()];
    const effective = ordered(fx.filter((x) => x.userId === m.user_id));
    return {
      userId: m.user_id, name: m.display_name?.trim() || "Someone on the trip", you: m.user_id === me,
      state: journey.state, since: journey.since, departedAt: journey.departedAt, atPlace: journey.atPlace,
      visited: vals.filter((v) => v === "done").length, skipped: vals.filter((v) => v === "skipped").length,
      lastEventAt: effective.length ? effective[effective.length - 1].occurredAt : null,
    };
  });
}

/** How many people say they are at a place right now, out of the group: "2 of 4". Individual arrivals, not a group arrival. */
export function arrivedCount(progress: MemberProgress[], placeId: string): { at: number; of: number } {
  return { at: progress.filter((m) => m.atPlace?.placeId === placeId).length, of: progress.length };
}
