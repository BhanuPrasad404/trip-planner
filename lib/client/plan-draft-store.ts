"use client";

// The guided flow's draft, kept on THIS phone only, so a guest who signs up at "Plan my trip" comes back to exactly where they were.
// Nothing here is sent anywhere. Cleared once the trip is created. Old drafts (older than a week) are ignored.
import type { Draft } from "@/lib/intake/draft";

const KEY = "tm:plan-draft:v1";
const MAX_AGE_MS = 7 * 24 * 3_600_000;

export function saveDraft(d: Draft, now = Date.now()) {
  try { window.localStorage.setItem(KEY, JSON.stringify({ at: now, draft: d })); } catch { /* storage blocked: the draft lives only in this page */ }
}

export function loadDraft(now = Date.now()): Draft | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: number; draft?: Draft };
    if (!v?.draft || typeof v.at !== "number" || now - v.at > MAX_AGE_MS || typeof v.draft.text !== "string" || !Array.isArray(v.draft.places)) return null;
    return v.draft;
  } catch { return null; }
}

export function clearDraft() {
  try { window.localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
