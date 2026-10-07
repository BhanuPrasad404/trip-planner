"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";

export function SharePlan({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  }

  return (
    <section aria-labelledby="share-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="share-heading" className="font-display text-lg font-semibold text-pine">Share the plan</h2>
      <p className="mt-1 text-sm text-ink-muted">Send the day-by-day itinerary as a message — no app needed to read it.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={copy}>{copied ? <span className="inline-flex items-center gap-1.5"><Glyph name="check" size={14} />Copied</span> : "Copy as text"}</Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1f7a4d] px-3.5 text-sm font-bold text-white hover:bg-[#19653f]"
        >
          Send on WhatsApp<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-muted">
        {copied && "Plan copied to clipboard."}
        {failed && "Couldn't copy automatically — use the WhatsApp button instead."}
      </p>
    </section>
  );
}
