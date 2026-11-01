"use client";

import { useCallback, useEffect, useState } from "react";

export type Commitment = {
  id: string; trip_id: string; place_id: string | null; label: string; kind: "hotel" | "ticket" | "event" | "reservation" | "transport" | "activity";
  constraint_class: "fixed" | "time_sensitive"; day: number; earliest_min: number | null; latest_min: number | null;
  source: "user_entered" | "imported" | "confirmed"; reference: string | null; notes: string | null; created_by: string | null;
};
export type NewCommitment = {
  label: string; kind: Commitment["kind"]; constraint_class: Commitment["constraint_class"]; day: number;
  earliest_min?: number | null; latest_min?: number | null; place_id?: string | null; confirmed: boolean; reference?: string | null; notes?: string | null;
};

async function call(method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), ...(method === "GET" ? { cache: "no-store" as const } : {}) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, data: { error: "No connection. Bookings are saved to the trip, so this needs one. Nothing was changed." } };
  }
}

/** The trip's bookings: read from the server, changed only with a connection (they are shared with everyone on the trip). */
export function useCommitments(tripId: string, enabled = true) {
  const [list, setList] = useState<Commitment[]>([]);
  const [stored, setStored] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await call("GET", `/api/trips/${tripId}/commitments`);
    if (!r.ok) return; // offline: the list on screen stays
    setStored(r.data.stored !== false);
    setList(Array.isArray(r.data.commitments) ? (r.data.commitments as Commitment[]) : []);
  }, [tripId]);
  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [enabled, load]);

  const run = useCallback(async (f: () => Promise<{ ok: boolean; data: Record<string, unknown> }>): Promise<boolean> => {
    setBusy(true); setError(null);
    const r = await f();
    setBusy(false);
    if (!r.ok) { setError(String(r.data.error ?? "Couldn't save that. Nothing was changed.")); return false; }
    await load();
    return true;
  }, [load]);

  const add = useCallback((c: NewCommitment) => run(() => call("POST", `/api/trips/${tripId}/commitments`, c)), [run, tripId]);
  const setConfirmed = useCallback((id: string, confirmed: boolean) => run(() => call("PATCH", `/api/trips/${tripId}/commitments/${id}`, { confirmed })), [run, tripId]);
  const remove = useCallback((id: string) => run(() => call("DELETE", `/api/trips/${tripId}/commitments/${id}`)), [run, tripId]);
  return { list, stored, error, busy, add, setConfirmed, remove, reload: load, clearError: () => setError(null) };
}
export type Commitments = ReturnType<typeof useCommitments>;
