"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { announceTripStatus } from "@/lib/client/stop-signal";
import { safeColor } from "@/lib/format";
import { MEMBERS_CHANGED_BROADCAST, forgetTripLocally, markDeletingHere, unmarkDeletingHere } from "@/lib/trip/deletion";
import type { TripMember } from "@/lib/types";
import { Button } from "./ui/Button";
import { FormError } from "./ui/Field";

type Props = { tripId: string; tripName: string; members: TripMember[]; ownerId: string; userId: string };

type Pending =
  | { kind: "leave" }
  | { kind: "owner-leave" }
  | { kind: "remove"; member: TripMember }
  | { kind: "transfer"; member: TripMember };

const nameOf = (m: TripMember) => m.display_name?.trim() || "A member";

/**
 * Who is on the trip, and the membership actions:
 *   • a member can LEAVE;
 *   • the owner can REMOVE another member, or MAKE another member the owner;
 *   • the owner cannot just leave: the dialog offers handing the trip over (then leaving) or deleting it.
 * Every action is confirmed and says what happens to the person's stops, votes and live location.
 */
export function MembersPanel({ tripId, tripName, members, ownerId, userId }: Props) {
  const router = useRouter();
  const titleId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [heir, setHeir] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = ownerId === userId;
  const others = members.filter((m) => m.user_id !== userId);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setPending(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy]);

  const open = (p: Pending) => { setError(null); setHeir(""); setPending(p); };
  const close = () => { if (!busy) setPending(null); };

  async function send(url: string, init: RequestInit): Promise<boolean> {
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(body.error ?? "That didn't work. Please try again."); return false; }
      return true;
    } catch {
      setError("We couldn't reach the server. Check your connection. Nothing was changed.");
      return false;
    }
  }

  async function leave() {
    markDeletingHere(tripId); // this page must not show "you were removed" to the person who chose to leave
    if (!(await send(`/api/trips/${tripId}/members/${userId}`, { method: "DELETE" }))) { unmarkDeletingHere(tripId); return false; }
    forgetTripLocally(tripId);
    await announceTripStatus(tripId, MEMBERS_CHANGED_BROADCAST);
    router.replace(`/trips?left=1`);
    router.refresh();
    return true;
  }

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    let done = false;
    if (pending.kind === "leave") {
      done = await leave();
    } else if (pending.kind === "remove") {
      done = await send(`/api/trips/${tripId}/members/${pending.member.user_id}`, { method: "DELETE" });
    } else if (pending.kind === "transfer" || pending.kind === "owner-leave") {
      const to = pending.kind === "transfer" ? pending.member.user_id : heir;
      if (!to) { setError("Choose who should own the trip."); setBusy(false); return; }
      done = await send(`/api/trips/${tripId}/owner`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: to }) });
      if (done && pending.kind === "owner-leave") {
        done = await leave();
        if (!done) { setPending({ kind: "leave" }); await announceTripStatus(tripId, MEMBERS_CHANGED_BROADCAST); router.refresh(); } // handed over, but not yet left: you are a member now
      }
    }
    if (done && pending.kind !== "leave" && pending.kind !== "owner-leave") {
      await announceTripStatus(tripId, MEMBERS_CHANGED_BROADCAST);
      setPending(null);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="members-heading" className="rounded-3xl border border-line bg-white p-5">
      <h2 id="members-heading" className="font-display text-lg font-semibold text-pine">Members</h2>
      <ul className="mt-3 divide-y divide-line">
        {members.map((m) => {
          const me = m.user_id === userId;
          const owner = m.user_id === ownerId;
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: safeColor(m.avatar_color) }}>{nameOf(m)[0]?.toUpperCase()}</span>
              <span className="min-w-0 flex-1 break-words text-sm font-semibold text-ink">
                {nameOf(m)}{me && " (you)"}
                {owner && <span className="ml-2 rounded-full bg-sky px-2 py-0.5 text-xs font-semibold text-ink-muted">Owner</span>}
              </span>
              <span className="flex gap-2">
                {isOwner && !me && <Button size="sm" variant="secondary" onClick={() => open({ kind: "transfer", member: m })}>Make owner</Button>}
                {isOwner && !me && <Button size="sm" variant="danger" onClick={() => open({ kind: "remove", member: m })}>Remove</Button>}
                {me && <Button size="sm" variant="secondary" onClick={() => open(isOwner ? { kind: "owner-leave" } : { kind: "leave" })}>Leave trip</Button>}
              </span>
            </li>
          );
        })}
      </ul>

      {pending && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-pine/50 p-4 sm:items-center" onClick={close}>
          <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {pending.kind === "leave" && (
              <>
                <h2 id={titleId} className="font-display text-2xl font-semibold text-pine">Leave &ldquo;{tripName}&rdquo;?</h2>
                <p className="text-base text-ink">You will no longer see this trip. Your <strong>votes</strong> and <strong>live location</strong> are removed. The <strong>stops you added stay</strong> with the group, without your name.</p>
                <p className="text-sm text-ink-muted">To come back, someone has to send you the invite link again.</p>
              </>
            )}
            {pending.kind === "remove" && (
              <>
                <h2 id={titleId} className="font-display text-2xl font-semibold text-pine">Remove {nameOf(pending.member)}?</h2>
                <p className="text-base text-ink">They will no longer see this trip, and their screen will say they were removed. Their <strong>votes</strong> and <strong>live location</strong> are removed. The <strong>stops they added stay</strong> on the trip, without their name.</p>
                <p className="text-sm text-ink-muted">They could join again with the current invite link. To stop that, make a new invite link.</p>
              </>
            )}
            {pending.kind === "transfer" && (
              <>
                <h2 id={titleId} className="font-display text-2xl font-semibold text-pine">Make {nameOf(pending.member)} the owner?</h2>
                <p className="text-base text-ink">They will be able to change the trip, remove members and delete it. You stay on the trip as a member.</p>
              </>
            )}
            {pending.kind === "owner-leave" && (
              <>
                <h2 id={titleId} className="font-display text-2xl font-semibold text-pine">You own this trip</h2>
                {others.length > 0 ? (
                  <>
                    <p className="text-base text-ink">Before you leave, hand it over to another member. Or, to end it for everyone, delete the trip instead (at the bottom of this page).</p>
                    <label className="block text-sm font-semibold text-ink">
                      New owner
                      <select value={heir} onChange={(e) => setHeir(e.target.value)} className="mt-1.5 block min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base">
                        <option value="">Choose a member…</option>
                        {others.map((m) => <option key={m.user_id} value={m.user_id}>{nameOf(m)}</option>)}
                      </select>
                    </label>
                  </>
                ) : (
                  <p className="text-base text-ink">You&apos;re the only person on this trip, so there is no one to hand it over to. Delete the trip instead (at the bottom of this page), or keep it.</p>
                )}
              </>
            )}
            <FormError message={error} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
              {!(pending.kind === "owner-leave" && others.length === 0) && (
                <Button variant={pending.kind === "transfer" ? "primary" : "danger"} onClick={confirm} loading={busy} disabled={pending.kind === "owner-leave" && !heir}
                  loadingLabel="Working…">
                  {pending.kind === "leave" ? "Leave trip" : pending.kind === "remove" ? "Remove" : pending.kind === "transfer" ? "Make owner" : "Hand over and leave"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
