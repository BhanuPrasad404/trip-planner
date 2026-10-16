"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { announceTripStatus } from "@/lib/client/stop-signal";
import { useNowMinute } from "@/lib/client/use-now";
import { MEMBERS_CHANGED_BROADCAST } from "@/lib/trip/deletion";
import { Button } from "./ui/Button";
import { FormError } from "./ui/Field";
import { Glyph } from "@/components/ui/Glyph";

type Props = {
  inviteUrl: string;
  tripName: string;
  /** Owner tools (new link + expiry) need these; without them the panel only shares the link. */
  tripId?: string;
  isOwner?: boolean;
  expiresAt?: string | null;
};

const EXPIRY_CHOICES = [
  { hours: null, label: "Never expires" },
  { hours: 24, label: "Works for 24 hours" },
  { hours: 168, label: "Works for 7 days" },
  { hours: 720, label: "Works for 30 days" },
] as const;

/** "18 Oct, 2:30 pm" in India time. */
export const expiryText = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function InvitePanel({ inviteUrl, tripName, tripId, isOwner = false, expiresAt = null }: Props) {
  const router = useRouter();
  const nowMinute = useNowMinute(); // 0 on the server: "expired" is decided in the browser, with the real clock
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const expired = !!expiresAt && nowMinute > 0 && new Date(expiresAt).getTime() <= nowMinute * 60_000;

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true); // clipboard blocked — the link stays visible below for manual copy
    }
  }

  async function rotate() {
    if (!tripId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expires_in_hours: hours }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(body.error ?? "We couldn't make a new link. Your current link still works."); return; }
      setAsking(false);
      setNotice("New link ready. The old link no longer works.");
      void announceTripStatus(tripId, MEMBERS_CHANGED_BROADCAST); // other members' screens show the new link
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Your current link still works.");
    } finally {
      setBusy(false);
    }
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Join our trip “${tripName}” on Trailmate: ${inviteUrl}`)}`;

  return (
    <section aria-labelledby="invite-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="invite-heading" className="font-display text-lg font-semibold text-pine">
        Invite your group
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Anyone with this link can join and edit the plan.</p>

      {expired ? (
        <p role="status" className="mt-3 rounded-xl border border-clay/30 bg-clay-light px-3 py-2.5 text-sm font-medium text-clay-ink">
          {isOwner ? "This link has expired. Make a new one to invite more people." : "This link has expired. Ask the trip owner for a new one."}
        </p>
      ) : (
        <>
          <input
            readOnly
            aria-label="Invite link"
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 w-full rounded-xl border border-line bg-sky px-3 py-2.5 font-mono text-xs text-ink-muted"
          />
          <p className="mt-1.5 text-xs text-ink-muted">{expiresAt ? `Expires ${expiryText(expiresAt)}` : "Never expires"}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? <span className="inline-flex items-center gap-1.5"><Glyph name="check" size={14} />Copied</span> : "Copy link"}
            </Button>
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1f7a4d] px-3.5 text-sm font-bold text-white hover:bg-[#19653f]"
            >
              Share on WhatsApp<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </>
      )}
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-muted">
        {copied && "Link copied to clipboard."}
        {failed && "Couldn't copy automatically — select the link above and copy it."}
        {notice}
      </p>

      {isOwner && tripId && (
        <div className="mt-3 border-t border-line pt-3">
          {!asking ? (
            <Button size="sm" variant="secondary" onClick={() => { setAsking(true); setError(null); setNotice(null); }}>New invite link</Button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink">The old link stops working at once. Anyone who already joined stays on the trip.</p>
              <label className="block text-sm font-semibold text-ink">
                How long should the new link work?
                <select value={hours === null ? "" : String(hours)} onChange={(e) => setHours(e.target.value ? Number(e.target.value) : null)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base">
                  {EXPIRY_CHOICES.map((c) => <option key={c.label} value={c.hours === null ? "" : String(c.hours)}>{c.label}</option>)}
                </select>
              </label>
              <FormError message={error} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={rotate} loading={busy} loadingLabel="Making link…">Make new link</Button>
                <Button size="sm" variant="secondary" onClick={() => setAsking(false)} disabled={busy}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
