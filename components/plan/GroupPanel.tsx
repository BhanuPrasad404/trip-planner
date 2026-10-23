"use client";

// "Ask your group" on the trip's Plan page. The owner shares a link; friends answer 3 things without signing up; everyone on the trip
// sees where the group agrees and where it splits. Agreements can become the trip's preferences with one tap; splits stay visible.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { Skeleton } from "@/components/ui/Skeleton";
import { AVOID_LABEL, type GroupSummary } from "@/lib/intake/group";
import { INTEREST_LABEL, PACE_LABEL, type Interest, type Pace } from "@/lib/intake/types";

type Answer = { id: string; name: string; answers: { pace?: Pace | null; interests?: Interest[]; avoid?: (keyof typeof AVOID_LABEL)[] }; member: boolean };
type Loaded = { owner: boolean; link: { code: string | null; open: boolean } | null; answers: Answer[]; summary: GroupSummary };

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, init);
    const b = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    return r.ok && b ? { ok: true, data: b } : { ok: false, error: b?.error ?? "Something went wrong. Please try again." };
  } catch { return { ok: false, error: "No connection. Please try again." }; }
}

export function GroupPanel({ tripId, onClose }: { tripId: string; onClose?: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  const load = useCallback(async () => {
    const r = await call<Loaded>(`/api/trips/${tripId}/poll`);
    if (r.ok) { setData(r.data); setError(null); } else setError(r.error);
  }, [tripId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function act(action: "open" | "close" | "new_link" | "apply") {
    setBusy(true); setError(null);
    const r = await call<object>(`/api/trips/${tripId}/poll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (action === "apply") setApplied(true);
    await load();
  }
  async function remove(id: string) {
    setBusy(true);
    const r = await call<object>(`/api/trips/${tripId}/poll`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer_id: id }) });
    setBusy(false);
    if (!r.ok) setError(r.error); else await load();
  }

  const url = data?.link?.code && typeof window !== "undefined" ? `${window.location.origin}/poll/${data.link.code}` : null;
  const share = url ? `Help plan our trip: tap and pick your pace, what you enjoy and anything to avoid (no sign-up). ${url}` : "";

  return (
    <section aria-labelledby="group-h" className="rounded-2xl border border-teal/30 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 id="group-h" className="font-display text-xl font-semibold text-pine">Ask your group</h2>
        {onClose && <button type="button" onClick={onClose} className="tm-action min-h-11 text-sm font-semibold">Close</button>}
      </div>
      <p className="mt-1 text-sm text-ink-muted">Friends pick their pace, what they enjoy and anything to avoid. No sign-up needed. They only see the trip&apos;s name.</p>
      <FormError message={error} />
      {!data && !error && <div className="mt-3 space-y-2"><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-20 w-full rounded-xl" /></div>}

      {data?.owner && (
        <div className="mt-3 space-y-2">
          {!data.link?.open ? (
            <Button onClick={() => void act("open")} loading={busy} loadingLabel="Making the link…" className="w-full">{data.link?.code ? "Take answers again" : "Make a link to share"}</Button>
          ) : url && (
            <>
              <p className="break-all rounded-xl bg-sky px-3.5 py-2.5 font-mono text-sm">{url}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(share).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }); }}>{copied ? "Copied" : "Copy message"}</Button>
                <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-line px-3.5 text-sm font-bold text-pine">Share on WhatsApp</a>
                <Button size="sm" variant="ghost" onClick={() => void act("close")} disabled={busy}>Stop taking answers</Button>
                <Button size="sm" variant="ghost" onClick={() => void act("new_link")} disabled={busy}>New link</Button>
              </div>
              <p className="text-xs text-ink-muted">“New link” stops the old one at once.</p>
            </>
          )}
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-ink">{data.summary.count === 0 ? "No answers yet." : `${data.summary.count} ${data.summary.count === 1 ? "answer" : "answers"}`}</p>
          {data.summary.agree.length > 0 && (
            <div><p className="text-xs font-bold uppercase tracking-wide text-teal-ink">The group agrees</p>
              <ul className="mt-1 space-y-1">{data.summary.agree.map((a) => <li key={a} className="flex items-start gap-1.5 text-sm"><Glyph name="checkCircle" size={15} className="mt-0.5 text-teal-ink" />{a}</li>)}</ul></div>
          )}
          {data.summary.split.length > 0 && (
            <div><p className="text-xs font-bold uppercase tracking-wide text-[#7a4a00]">Split: you decide</p>
              <ul className="mt-1 space-y-1">{data.summary.split.map((a) => <li key={a} className="flex items-start gap-1.5 text-sm"><Glyph name="warn" size={15} className="mt-0.5 text-[#7a4a00]" />{a}</li>)}</ul></div>
          )}
          {data.owner && data.summary.agree.length > 0 && (
            <Button size="sm" onClick={() => void act("apply")} loading={busy} disabled={applied}>{applied ? "Saved as the trip's preferences" : "Use what the group agreed"}</Button>
          )}
          {data.answers.length > 0 && (
            <details className="rounded-xl border border-line px-3.5 py-2">
              <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold">Each answer</summary>
              <ul className="divide-y divide-line">{data.answers.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span><span className="font-semibold">{a.name}</span>{a.member ? "" : " (guest)"}<span className="block text-ink-muted">{[a.answers.pace ? PACE_LABEL[a.answers.pace] : null, ...(a.answers.interests ?? []).map((i) => INTEREST_LABEL[i]), ...(a.answers.avoid ?? []).map((x) => `no ${AVOID_LABEL[x]?.toLowerCase() ?? x}`)].filter(Boolean).join(" · ") || "No preferences"}</span></span>
                  {data.owner && <button type="button" onClick={() => void remove(a.id)} disabled={busy} className="tm-action min-h-11 shrink-0 text-xs font-semibold">Remove<span className="sr-only"> {a.name}&apos;s answer</span></button>}
                </li>
              ))}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
