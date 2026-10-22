"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TRIP_DELETED_BROADCAST, forgetTripLocally, markDeletingHere, tripNameMatches, tripStatusChannel } from "@/lib/trip/deletion";
import { Button } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";

/** Tell members who have the trip open, so they see "deleted by the owner" at once. Best effort: their app also checks by itself. */
async function announceDeleted(tripId: string): Promise<void> {
  try {
    const sb = createClient();
    const topic = tripStatusChannel(tripId);
    // This page's own watcher already listens on the topic (shared channel): send on it, and never remove it from under the watcher.
    const existing = sb.getChannels().find((c) => c.topic === `realtime:${topic}`);
    const channel = existing ?? sb.channel(topic);
    if (!existing) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        channel.subscribe((status) => { if (status === "SUBSCRIBED") { clearTimeout(t); resolve(); } });
      });
    }
    await channel.send({ type: "broadcast", event: TRIP_DELETED_BROADCAST, payload: { tripId } });
    if (!existing) await sb.removeChannel(channel);
  } catch {
    // no realtime: members find out on their next check (focus, or within a minute)
  }
}

/** Owner only. Permanently deletes the trip after the owner types its name. */
export function DeleteTripButton({ tripId, tripName }: { tripId: string; tripName: string }) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = tripNameMatches(typed, tripName);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const close = () => { if (busy) return; setOpen(false); setTyped(""); setError(null); };

  async function confirmDelete() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_name: typed }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "We couldn't delete the trip. Please try again.");
        setBusy(false);
        return;
      }
      markDeletingHere(tripId);
      forgetTripLocally(tripId);
      await announceDeleted(tripId);
      router.replace("/trips?deleted=1");
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection. Nothing was deleted.");
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>Delete trip</Button>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-pine/50 p-4 sm:items-center" onClick={close}>
          <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 id={titleId} className="font-display text-2xl font-semibold text-pine">Delete &ldquo;{tripName}&rdquo;?</h2>
            <p className="text-base text-ink">
              This permanently removes the trip for <strong>everyone</strong> on it: all stops and ideas, votes, members, live locations and trip photos. It can&apos;t be undone.
            </p>
            <p className="text-sm text-ink-muted">
              Just want to close it? Use <strong>Finish trip</strong> or <strong>Call it off</strong> instead. Those keep the stops and memories.
            </p>
            <TextField label="Type the trip name to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus placeholder={tripName} />
            <FormError message={error} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={close} disabled={busy}>Keep trip</Button>
              <Button variant="danger" onClick={confirmDelete} disabled={!matches} loading={busy} loadingLabel="Deleting…">Delete forever</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
