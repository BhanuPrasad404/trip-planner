"use client";

// Share the day-by-day plan. On a phone the "Share" button opens the phone's own share sheet (WhatsApp, Instagram, Messages, Telegram,
// anything installed) with the plan as a clean message; WhatsApp and Copy stay as direct buttons. The message is built by lib/share-text.ts.
import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";

export function SharePlan({ text, title = "My trip plan on TrailMate" }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { queueMicrotask(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function")); }, []);

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

  async function share() {
    try { await navigator.share({ title, text }); setFailed(false); }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) void copy(); }   // closing the sheet is not an error; anything else falls back to copying
  }

  return (
    <section aria-labelledby="share-heading" className="rounded-3xl border border-line bg-white p-5 shadow-card">
      <h2 id="share-heading" className="font-display text-lg font-semibold text-pine">Share the plan</h2>
      <p className="mt-1 text-sm text-ink-muted">Send the day-by-day itinerary as a message, with a link to open the trip on TrailMate. No app needed to read it.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canShare && <Button size="sm" onClick={() => void share()}><Glyph name="external" size={14} />Share</Button>}
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-teal px-4 text-sm font-bold text-[var(--tm-on-accent)] transition-colors hover:bg-teal-ink sm:min-h-10"
        >
          Send on WhatsApp<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <Button size="sm" variant="secondary" onClick={copy}>{copied ? <span className="inline-flex items-center gap-1.5"><Glyph name="check" size={14} />Copied</span> : "Copy as text"}</Button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-muted">
        {copied && "Plan copied to clipboard."}
        {failed && "Couldn't copy automatically. Use the WhatsApp button instead."}
      </p>
    </section>
  );
}
