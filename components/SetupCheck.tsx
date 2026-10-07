"use client";

import { useState } from "react";
import type { Setup } from "@/lib/config";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";

/** What is connected on this server, and — when something is not — exactly why and what to do. Never shows a key. */
export function SetupCheck({ items }: { items: Setup[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function testAi() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/health/ai", { method: "POST" });
      const body = await res.json().catch(() => null);
      setResult(res.ok && body ? { ok: !!body.ok, message: String(body.message) } : { ok: false, message: body?.error ?? "Couldn't run the test." });
    } catch {
      setResult({ ok: false, message: "Network problem — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="setup-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="setup-heading" className="font-display text-lg font-semibold text-pine">Setup check</h2>
      <p className="mt-1 text-sm text-ink-muted">What this server has connected. Secrets are never shown — only whether they are present.</p>
      <ul className="mt-3 divide-y divide-line">
        {items.map((i) => (
          <li key={i.id} className="py-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-pine">
              <Glyph name={i.ok && !i.problem ? "checkCircle" : i.ok ? "warn" : "circle"} size={18} className={i.ok && !i.problem ? "text-teal" : i.ok ? "text-marigold" : "text-ink-muted"} />{i.label}
              <span className="sr-only">{i.ok && !i.problem ? "is set up" : "needs attention"}</span>
            </p>
            {i.problem && <p className="mt-1 text-clay-ink">{i.problem}</p>}
            {i.fix && <p className="mt-1 text-ink"><strong>What to do:</strong> {i.fix}</p>}
            {i.fallback && <p className="mt-1 text-xs text-ink-muted">{i.fallback}</p>}
            {i.id === "ai" && (
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={testAi} disabled={busy}>{busy ? "Testing…" : "Test my AI key"}</Button>
                {result && <p role="status" className={`mt-2 text-sm font-semibold ${result.ok ? "text-teal-ink" : "text-clay-ink"}`}><Glyph name={result.ok ? "checkCircle" : "warn"} size={16} className="mr-1.5 inline align-text-bottom" />{result.message}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
