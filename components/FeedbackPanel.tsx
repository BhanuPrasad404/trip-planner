"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { FormError } from "./ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";

const FACES: { value: number; icon: GlyphName; label: string }[] = [
  { value: 1, icon: "faceAngry", label: "Very bad" },
  { value: 2, icon: "faceSad", label: "Bad" },
  { value: 3, icon: "faceOkay", label: "Okay" },
  { value: 4, icon: "faceGood", label: "Good" },
  { value: 5, icon: "faceGreat", label: "Great" },
];

export function FeedbackPanel({ tripId }: { tripId: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, rating, trip_id: tripId, page: window.location.pathname }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't send. Please try again.");
        return;
      }
      setSent(true);
      setMessage("");
      setRating(null);
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="feedback-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="feedback-heading" className="font-display text-lg font-semibold text-pine">Help us improve</h2>
      <p className="mt-1 text-sm text-ink-muted">Something confusing, wrong or missing? Tell us — a sentence is enough.</p>

      {sent ? (
        <p role="status" className="mt-3 rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">
          Thank you! Your feedback was sent.{" "}
          <button type="button" onClick={() => setSent(false)} className="font-semibold underline underline-offset-2">Send more</button>
        </p>
      ) : (
        <form onSubmit={send} className="mt-3 space-y-3" noValidate>
          <div role="group" aria-label="How is Trailmate working for you?" className="flex gap-1.5">
            {FACES.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={rating === f.value}
                aria-label={f.label}
                onClick={() => setRating(rating === f.value ? null : f.value)}
                className={`min-h-11 flex-1 rounded-xl border text-xl ${rating === f.value ? "border-teal bg-teal-light" : "border-line bg-white hover:border-teal"}`}
              >
                <Glyph name={f.icon} size={22} className="mx-auto" /><span className="sr-only">{f.label}</span>
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="feedback-message" className="sr-only">Your feedback</label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. The pin for Kondapalli Fort was in the wrong place."
              className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/40"
            />
          </div>
          <FormError message={error} />
          <Button type="submit" size="sm" disabled={sending || message.trim().length < 3}>
            {sending ? "Sending…" : "Send feedback"}
          </Button>
        </form>
      )}
    </section>
  );
}
