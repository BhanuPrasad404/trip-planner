"use client";

import { useCallback, useState } from "react";
import { snapshotPlaces, type PlaceSnapshot } from "@/lib/snapshot";
import type { PlaceWithSeason } from "@/lib/types";
import { GRADE_LIMITS_M, STALE_MS } from "@/lib/location/quality";

export type UndoState = { label: string; places: PlaceSnapshot[]; deleteIds: string[] };

type Args = {
  tripId: string;
  places: PlaceWithSeason[];
  onChanged: () => void;
  /** Local clock from the browser (null until it is ready). */
  localDate: string | null;
  /** Early start: the planned day being driven today while the trip's own dates are still ahead. */
  earlyDay?: number | null;
  localTime: string | null;
};

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const getPosition = () =>
  new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    // A fresh, precise reading or nothing: re-planning "from here" with a cached or network-guessed position would plan from the wrong place.
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords.accuracy <= GRADE_LIMITS_M.rough && Date.now() - p.timestamp < STALE_MS ? { lat: p.coords.latitude, lng: p.coords.longitude } : null),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10_000 }
    );
  });

/**
 * Every change the Autopilot or the traveller makes to the plan goes through here, so each one is
 * (1) explicit, (2) explained afterwards, and (3) UNDOABLE: a snapshot of what changed is kept until the next action.
 */
export function useTripActions({ tripId, places, onChanged, localDate, localTime, earlyDay }: Args) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const call = useCallback(async (url: string, init: RequestInit, failMsg: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? failMsg);
        return null;
      }
      return body ?? {};
    } catch {
      setError("Network problem — check your connection and try again.");
      return null;
    }
  }, []);

  const setStatus = useCallback(
    async (id: string, status: "planned" | "done" | "skipped", label?: string) => {
      setError(null);
      setBusyId(id);
      const before = snapshotPlaces(places, [id]);
      if (await call(`/api/places/${id}`, json("PATCH", { status }), "Couldn't update this stop.")) {
        if (status !== "planned" && label) setUndo({ label, places: before, deleteIds: [] });
        onChanged();
      }
      setBusyId(null);
    },
    [call, onChanged, places]
  );

  const moveToDay = useCallback(
    async (id: string, day: number | null, label?: string) => {
      setError(null);
      setBusyId(id);
      const before = snapshotPlaces(places, [id]);
      if (await call(`/api/places/${id}`, json("PATCH", { day_number: day }), "Couldn't move this stop.")) {
        setNotice(day === null ? "Moved to Ideas." : `Moved to Day ${day}.`);
        if (label) setUndo({ label, places: before, deleteIds: [] });
        onChanged();
      }
      setBusyId(null);
    },
    [call, onChanged, places]
  );

  const replanFromNow = useCallback(async (): Promise<{ text: string; warnings: string[] } | null> => {
    if (!localDate || !localTime) return null;
    setError(null);
    setReplanning(true);
    const before = snapshotPlaces(places); // a re-plan can touch several stops (and push some to tomorrow)
    const pos = await getPosition();
    const body = await call(`/api/trips/${tripId}/replan`, json("POST", { local_date: localDate, local_time: localTime, ...(earlyDay ? { day_number: earlyDay } : {}), ...(pos ?? {}) }), "Couldn't re-plan the day.");
    setReplanning(false);
    if (!body) return null;
    setUndo({ label: "Re-planned the rest of today", places: before, deleteIds: [] });
    onChanged();
    const moved = Number(body.moved) || 0;
    return { text: `Re-planned ${Number(body.scheduled) || 0} stop(s) from ${String(body.origin)}${moved ? `; ${moved} moved out of today` : ""}.`, warnings: (body.warnings as string[]) ?? [] };
  }, [call, earlyDay, localDate, localTime, onChanged, places, tripId]);

  /** "Go there": add a place as the next stop of a day. */
  const insertStop = useCallback(
    async (stop: { name: string; lat: number; lng: number; category?: string | null }, day: number) => {
      setError(null);
      setReplanning(true);
      const before = snapshotPlaces(places.filter((p) => p.day_number === day));
      const body = await call(`/api/trips/${tripId}/insert-stop`, json("POST", { ...stop, day_number: day, notes: "Added from Travel Radar" }), "Couldn't add this stop.");
      setReplanning(false);
      if (!body) return false;
      setUndo({ label: `Added ${stop.name} as your next stop`, places: before, deleteIds: [String(body.id)] });
      onChanged();
      return true;
    },
    [call, onChanged, places, tripId]
  );

  const runUndo = useCallback(async () => {
    if (!undo) return;
    setReplanning(true);
    const ok = await call(`/api/trips/${tripId}/restore`, json("POST", { places: undo.places, delete_ids: undo.deleteIds }), "Couldn't undo that.");
    setReplanning(false);
    if (ok) {
      setNotice("Undone — your plan is back the way it was.");
      setUndo(null);
      onChanged();
    }
  }, [call, onChanged, tripId, undo]);

  return { busyId, replanning, error, notice, undo, setError, setNotice, setBusyId, call, json, setStatus, moveToDay, replanFromNow, insertStop, runUndo, dismissUndo: () => setUndo(null) };
}
