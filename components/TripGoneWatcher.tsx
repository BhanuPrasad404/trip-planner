"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  MEMBERS_CHANGED_BROADCAST, TRIP_DELETED_BROADCAST, TRIP_DELETED_TITLE, TRIP_GONE_EVENT, TRIP_GONE_TITLE, TRIP_REMOVED_TITLE,
  forgetTripLocally, isDeletingHere, provesTripGone, tripStatusChannel,
} from "@/lib/trip/deletion";
import { sharedChannelPool } from "@/lib/client/shared-channel";
import { LinkButton } from "./ui/Button";

const CHECK_EVERY_MS = 60_000;

/** One status channel per trip on this page, shared by every watcher (lib/client/shared-channel.ts). */
export const joinTripStatus = sharedChannelPool(["deleted", "members"] as const, (sb, tripId, emit) =>
  sb.channel(tripStatusChannel(tripId))
    .on("broadcast", { event: TRIP_DELETED_BROADCAST }, () => emit("deleted"))
    .on("broadcast", { event: MEMBERS_CHANGED_BROADCAST }, () => emit("members")));

/**
 * Shown on every page of a trip. If the trip is deleted while someone has it open (planning, or driving with the map), they get a
 * clear message instead of a broken screen, and Drive mode stops GPS and location sharing.
 *
 * How it finds out: the owner's app broadcasts a hint at once, and this also re-checks whenever the page comes back into view and
 * once a minute. A hint is never trusted on its own (anyone could send one): the trip must really be missing from the database.
 * Being offline or a server error never counts as "deleted".
 */
export function TripGoneWatcher({ tripId }: { tripId: string }) {
  const [gone, setGone] = useState<null | "deleted" | "removed" | "gone">(null);
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; });

  useEffect(() => {
    let sb: ReturnType<typeof createClient>;
    try {
      sb = createClient();
    } catch {
      return;
    }
    let disposed = false;
    let checking = false;
    let hinted: null | "deleted" | "removed" = null;
    let found = false;

    const check = async (onStillThere?: () => void) => {
      if (disposed || found || checking || isDeletingHere(tripId)) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      checking = true;
      try {
        const res = await sb.from("trips").select("id").eq("id", tripId).maybeSingle();
        if (disposed || found || isDeletingHere(tripId)) return;
        if (!provesTripGone(res)) { if (!res.error) onStillThere?.(); return; }
        found = true;
        forgetTripLocally(tripId);
        window.dispatchEvent(new CustomEvent(TRIP_GONE_EVENT, { detail: { tripId } }));
        setGone(hinted ?? "gone");
      } catch {
        // offline / server trouble: proves nothing, try again later
      } finally {
        checking = false;
      }
    };

    // Shared: the trip layout's watcher hands over to the drive's (and back) without losing a hint on a channel that is closing.
    const leaveDeleted = joinTripStatus(sb, tripId, "deleted", () => { hinted = "deleted"; void check(); });
    // Someone left or was removed (maybe me): if I can still see the trip it was someone else, so just refresh the member list.
    const leaveMembers = joinTripStatus(sb, tripId, "members", () => { hinted = "removed"; void check(() => { hinted = null; routerRef.current.refresh(); }); });
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(onVisible, CHECK_EVERY_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      leaveDeleted();
      leaveMembers();
    };
  }, [tripId]);

  if (!gone) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-pine/60 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="trip-gone-title" className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 text-center shadow-xl">
        <h2 id="trip-gone-title" className="font-display text-2xl font-semibold text-pine">{gone === "deleted" ? TRIP_DELETED_TITLE : gone === "removed" ? TRIP_REMOVED_TITLE : TRIP_GONE_TITLE}</h2>
        <p className="text-base text-ink">
          {gone === "deleted"
            ? "Its stops, votes and live locations have been removed for everyone."
            : gone === "removed"
              ? "The owner removed you, so you can no longer see this trip. Your votes and live location were removed; the stops you added stay with the group."
              : "It may have been deleted by the owner, or you are no longer a member of it."}
        </p>
        <p className="text-sm text-ink-muted">If you were driving, navigation and location sharing have stopped.</p>
        <LinkButton href="/trips" className="w-full">Go to my trips</LinkButton>
      </div>
    </div>
  );
}
