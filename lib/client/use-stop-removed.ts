"use client";

import { useEffect, useState } from "react";
import {
  decodeRemembered, detectStopChange, encodeRemembered, rememberKey, stopChangeMessage, type StopChange, type StopRef,
} from "@/lib/trip/stop-change";

type Seen = { key: string; targets: StopRef[] };
const keyOf = (targets: StopRef[], existingIds: ReadonlySet<string>) => `${targets.map((t) => t.id).join(",")}#${existingIds.size}:${[...existingIds].sort().join(",")}`;

/**
 * Notices that a stop on today's drive DISAPPEARED (deleted by me, by another member, or while this phone was asleep/offline) and
 * says where the drive goes now: "A stop was removed. Going to <next> now." / "… There are no more stops today."
 * Finishing or skipping a stop is not a removal and shows nothing here.
 *
 * `remember`: while driving, the current targets are kept on this device (ids and names only), so the message still appears if the
 * page was reloaded or the phone slept through the change.
 */
export function useStopRemoved({ tripId, targets, existingIds, remember }: { tripId: string; targets: StopRef[]; existingIds: ReadonlySet<string>; remember: boolean }) {
  const key = keyOf(targets, existingIds);
  const [seen, setSeen] = useState<Seen>({ key, targets });
  const [change, setChange] = useState<{ change: StopChange; n: number } | null>(null);
  const [seq, setSeq] = useState(0); // one number per removal noticed, so callers can react once to each

  // While this page is open: compare with what it showed before (React's "adjust state when inputs change" pattern).
  if (seen.key !== key) {
    const c = detectStopChange({ before: seen.targets, after: targets, existingIds });
    setSeen({ key, targets });
    if (c.kind !== "none") { setChange({ change: c, n: seq + 1 }); setSeq(seq + 1); }
  }

  // After a reload / long sleep: compare with what this device remembered while driving. Runs once per trip.
  useEffect(() => {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(rememberKey(tripId)); } catch { return; }
    const before = decodeRemembered(raw, Date.now());
    if (!before) return;
    const c = detectStopChange({ before, after: targets, existingIds });
    // (An effect may read the clock: a time-based number can never repeat one of the small counters used while the page is open.)
    const n = Date.now();
    if (c.kind === "target-removed") queueMicrotask(() => setChange({ change: c, n }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the stops as first loaded are compared with the remembered ones
  }, [tripId]);

  useEffect(() => {
    try {
      if (remember && targets.length > 0) window.localStorage.setItem(rememberKey(tripId), encodeRemembered(targets, Date.now()));
      else if (remember) window.localStorage.removeItem(rememberKey(tripId)); // nothing left to drive to: nothing to compare later
    } catch {
      // storage blocked: the message still works while the page stays open
    }
  }, [tripId, remember, targets]);

  const message = change ? stopChangeMessage(change.change) : null;
  return { change: change?.change ?? ({ kind: "none" } as StopChange), message, at: change?.n ?? 0, dismiss: () => setChange(null) };
}
