"use client";

import { createClient } from "@/lib/supabase/client";
import { tripStatusChannel } from "@/lib/trip/deletion";

// "The stops of this trip just changed" — sent by the app that made the change, so every other open screen of the trip
// (Live, Map, Plan; mine on another device or a friend's) reloads its stops at once. Needed for DELETES in particular: Supabase
// Realtime cannot filter delete events by trip, so a deleted stop was invisible to other screens until they were reloaded.
// It is only a HINT: it carries no stop data, and a listener just re-reads the stops through Row Level Security.
export const stopsChannel = (tripId: string) => `trip-stops-${tripId}`;
export const STOPS_CHANGED = "stops-changed";

export async function announceStopsChanged(tripId: string): Promise<void> {
  try {
    const sb = createClient();
    const topic = stopsChannel(tripId);
    // This page may already listen on the topic (useTripChanges): reuse that channel and never remove it.
    const existing = sb.getChannels().find((c) => c.topic === `realtime:${topic}`);
    const channel = existing ?? sb.channel(topic);
    await channel.httpSend(STOPS_CHANGED, { at: Date.now() }); // REST delivery: no need to join the channel first
    if (!existing) await sb.removeChannel(channel);
  } catch {
    // Realtime unavailable: other screens still notice on their next check (coming back to the app, or the drive-mode check).
  }
}

/** A hint on the trip's status channel (lib/trip/deletion.ts): members changed, etc. Carries no data; listeners re-check. */
export async function announceTripStatus(tripId: string, event: string): Promise<void> {
  try {
    const sb = createClient();
    const topic = tripStatusChannel(tripId);
    const existing = sb.getChannels().find((c) => c.topic === `realtime:${topic}`);
    const channel = existing ?? sb.channel(topic);
    await channel.httpSend(event, { at: Date.now() });
    if (!existing) await sb.removeChannel(channel);
  } catch {
    // no realtime: the others notice on their next check
  }
}
