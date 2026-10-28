"use client";

import { useState } from "react";
import type { Setup } from "@/lib/config";
import { Button } from "./ui/Button";
import { Glyph } from "@/components/ui/Glyph";

/** What is connected on this server, and — when something is not — exactly why and what to do. Never shows a key. */
export function SetupCheck({ items }: { items: Setup[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string[] } | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapResult, setMapResult] = useState<{ ok: boolean; message: string; checks: { host: string; ok: boolean; ms: number; detail: string }[] } | null>(null);

  async function testMap() {
    setMapBusy(true); setMapResult(null);
    try {
      const res = await fetch("/api/health/map", { method: "POST" });
      const body = await res.json().catch(() => null);
      setMapResult(res.ok && body ? { ok: !!body.ok, message: String(body.message), checks: Array.isArray(body.checks) ? body.checks : [] } : { ok: false, message: body?.error ?? "Couldn't run the test.", checks: [] });
    } catch { setMapResult({ ok: false, message: "Network problem — try again.", checks: [] }); }
    finally { setMapBusy(false); }
  }

  async function testAi() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/health/ai", { method: "POST" });
      const body = await res.json().catch(() => null);
      setResult(res.ok && body ? { ok: !!body.ok, message: String(body.message), detail: Array.isArray(body.detail) ? body.detail.map(String) : [] } : { ok: false, message: body?.error ?? "Couldn't run the test." });
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
                <Button size="sm" variant="secondary" onClick={testAi} loading={busy} loadingLabel="Testing…">Test my AI key</Button>
                {result && <p role="status" className={`mt-2 text-sm font-semibold ${result.ok ? "text-teal-ink" : "text-clay-ink"}`}><Glyph name={result.ok ? "checkCircle" : "warn"} size={16} className="mr-1.5 inline align-text-bottom" />{result.message}</p>}
                {result && !result.ok && result.detail && result.detail.length > 0 && (
                  <details className="mt-2 rounded-xl bg-sky px-3 py-2 text-xs text-ink-muted">
                    <summary className="min-h-11 cursor-pointer py-3 font-semibold text-ink">What we tried (send this if you ask for help)</summary>
                    <ul className="mt-1 space-y-1 break-words">{result.detail.map((d) => <li key={d}>{d}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-line pt-3 text-sm">
        <p className="font-semibold text-pine">Map data servers</p>
        <p className="mt-1 text-xs text-ink-muted">Places, temples and roads come from free public OpenStreetMap servers. If a screen says they are busy, this shows which one answers and why another doesn&apos;t.</p>
        <div className="mt-2"><Button size="sm" variant="secondary" onClick={testMap} loading={mapBusy} loadingLabel="Testing (up to a minute)…">Test my map servers</Button></div>
        {mapResult && (
          <div role="status" className="mt-2">
            <p className={`font-semibold ${mapResult.ok ? "text-teal-ink" : "text-clay-ink"}`}><Glyph name={mapResult.ok ? "checkCircle" : "warn"} size={16} className="mr-1.5 inline align-text-bottom" />{mapResult.message}</p>
            {mapResult.checks.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">{mapResult.checks.map((c) => <li key={c.host} className="break-words">{c.ok ? "✓" : "✗"} {c.host}: {c.detail}{c.ok ? ` (${c.ms} ms)` : ""}</li>)}</ul>}
          </div>
        )}
      </div>
    </section>
  );
}
