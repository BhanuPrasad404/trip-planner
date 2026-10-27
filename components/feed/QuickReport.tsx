"use client";

import Link from "next/link";
import { useState } from "react";
import { knownPosition } from "@/lib/client/known-position";
import { CROWD_LABEL, CROWD_LEVELS, conditionLabel, WARNING_CONDITIONS, type CrowdLevel } from "@/lib/feed/experience";
import { buildQuickReport, muteAsking, NOTE_MAX, QUICK_CONDITIONS } from "@/lib/feed/quick-report";
import { postPath } from "@/lib/feed/share";
import { Sheet } from "./Sheet";

const local = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/**
 * Asked when a stop is marked done: "How was it?" One or two taps, a note if they like, done. It says plainly who it helps
 * and that nothing is posted until they press Share. "Not now" is always one tap away, and "Don't ask again" really stops it.
 */
export function QuickReport({ place, onClose }: { place: { name: string; lat: number; lng: number }; onClose: () => void }) {
  const [crowd, setCrowd] = useState<CrowdLevel | null>(null);
  const [conditions, setConditions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" } | { kind: "done"; id: string; fromArea: boolean } | { kind: "error"; text: string; profile?: boolean }>({ kind: "idle" });
  const draft = buildQuickReport({ place, crowd, conditions, note, device: null });
  const toggle = (c: string) => setConditions((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));

  async function share() {
    if (state.kind === "sending") return;
    const ready = buildQuickReport({ place, crowd, conditions, note, device: await knownPosition() });
    if (!ready.ok) { setState({ kind: "error", text: ready.reason }); return; }
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ready.body) });
      const body = await res.json().catch(() => null);
      if (res.status === 409) { setState({ kind: "error", text: "Pick a username first, then you can share.", profile: true }); return; }
      if (!res.ok) throw new Error(body?.error ?? "Couldn't share it. Please try again.");
      setState({ kind: "done", id: body.id, fromArea: !!body.fromArea });
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error && e.message !== "Failed to fetch" ? e.message : "No connection. Your taps are kept: try again when you have signal." });
    }
  }

  if (state.kind === "done") {
    return (
      <Sheet title="Shared" onClose={onClose}>
        <div className="space-y-4 px-5 py-6 text-center">
          <p className="tm-pop font-display text-2xl font-semibold text-pine">Thank you!</p>
          <p className="text-sm text-ink-muted">Travelers planning {place.name} will see it on Discover{state.fromArea ? ", marked as posted from the area" : ""}. When they use it to decide, it counts toward your badge.</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Link href={postPath(state.id)} className="inline-flex min-h-11 items-center rounded-full bg-teal px-5 text-sm font-semibold text-white">See your post</Link>
            <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-line px-5 text-sm font-semibold text-pine hover:bg-sky">Back to the trip</button>
          </div>
        </div>
      </Sheet>
    );
  }

  const chip = (on: boolean, warn = false) => `min-h-11 rounded-full px-4 text-sm font-semibold transition-colors motion-reduce:transition-none ${on ? (warn ? "bg-marigold text-pine" : "bg-teal text-white") : "border border-line text-ink hover:bg-sky"}`;
  return (
    <Sheet title={`How was ${place.name}?`} onClose={onClose}>
      <div className="space-y-5 px-4 py-4">
        <p className="text-sm text-ink-muted">One tap helps the next traveler decide. Nothing is posted until you press Share.</p>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-pine">How crowded?</legend>
          <div className="flex flex-wrap gap-2">
            {CROWD_LEVELS.map((c) => <button key={c} type="button" aria-pressed={crowd === c} onClick={() => setCrowd((v) => (v === c ? null : c))} className={chip(crowd === c, c === "crowded")}>{CROWD_LABEL[c]}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-pine">Anything to know?</legend>
          <div className="flex flex-wrap gap-2">
            {QUICK_CONDITIONS.map((c) => <button key={c} type="button" aria-pressed={conditions.includes(c)} onClick={() => toggle(c)} className={chip(conditions.includes(c), WARNING_CONDITIONS.has(c))}>{conditionLabel(c)}</button>)}
          </div>
        </fieldset>
        <div>
          <label htmlFor="quick-note" className="mb-2 block text-sm font-semibold text-pine">A line for the next traveler <span className="font-normal text-ink-muted">(optional)</span></label>
          <textarea id="quick-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} rows={2} maxLength={NOTE_MAX} placeholder="Go before 9, the view clears by 10…"
            className="w-full resize-none rounded-2xl border border-line bg-white px-3.5 py-2.5 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/40" />
          <p className="mt-1 text-right text-xs tabular-nums text-ink-muted">{note.length}/{NOTE_MAX}</p>
        </div>
        {state.kind === "error" && <p role="alert" className="rounded-xl bg-clay-light px-3 py-2 text-sm text-clay-ink">{state.text} {state.profile && <Link href="/profile" className="font-semibold underline">Open profile</Link>}</p>}
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => void share()} disabled={!draft.ok || state.kind === "sending"} className="min-h-12 flex-1 rounded-full bg-teal px-6 text-sm font-semibold text-white disabled:opacity-50 min-[420px]:flex-none">{state.kind === "sending" ? "Sharing…" : "Share"}</button>
          <button type="button" onClick={onClose} className="min-h-12 rounded-full border border-line px-5 text-sm font-semibold text-pine hover:bg-sky">Not now</button>
        </div>
        {!draft.ok && <p className="text-xs text-ink-muted">{draft.reason}</p>}
        <button type="button" onClick={() => { muteAsking(local()); onClose(); }} className="min-h-11 text-xs font-semibold text-ink-muted underline">Don&apos;t ask me after stops</button>
      </div>
    </Sheet>
  );
}
