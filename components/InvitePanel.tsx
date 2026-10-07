"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";

export function InvitePanel({ inviteUrl, tripName }: { inviteUrl: string; tripName: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

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

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Join our trip “${tripName}” on Trailmate: ${inviteUrl}`)}`;

  return (
    <section aria-labelledby="invite-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="invite-heading" className="font-display text-lg font-semibold text-pine">
        Invite your group
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Anyone with this link can join and edit the plan.</p>

      <input
        readOnly
        aria-label="Invite link"
        value={inviteUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-3 w-full rounded-xl border border-line bg-sky px-3 py-2.5 font-mono text-xs text-ink-muted"
      />

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
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-muted">
        {copied && "Link copied to clipboard."}
        {failed && "Couldn't copy automatically — select the link above and copy it."}
      </p>
    </section>
  );
}
