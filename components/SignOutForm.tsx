"use client";

import type { ReactNode } from "react";
import { OUTBOX_PREFIX, countWaiting } from "@/lib/client/outbox";
import { DRIVE_SIGN_OUT_EVENT, DRIVE_SIGN_OUT_KEY, clearUserDrives } from "@/lib/drive/persist";

/** The message shown before signing out with changes still waiting on this phone (exported for tests). */
export const signOutWarning = (n: number) =>
  `${n === 1 ? "1 change is" : `${n} changes are`} still waiting to be sent (made without signal). If you sign out now, ${n === 1 ? "it is" : "they are"} deleted from this phone and never sent. Sign out anyway?`;

/**
 * Sign out — but first, if this person still has changes waiting on this phone (no signal yet), say so and let them stay.
 * Signing out deletes their waiting changes, so the next person on a shared phone can never see or send them.
 */
export function SignOutForm({ action, userId, className, children }: { action: () => Promise<void>; userId: string | null; className?: string; children?: ReactNode }) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!userId) return;
    try {
      const store = window.localStorage;
      const n = countWaiting(store, userId, Date.now());
      if (n > 0 && !window.confirm(signOutWarning(n))) { e.preventDefault(); return; }
      const mine: string[] = [];
      for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(`${OUTBOX_PREFIX}${userId}:`)) mine.push(k); }
      for (const k of mine) store.removeItem(k);
      // An active drive ends now: GPS and location sharing stop while still signed in, and nothing of it is left for the next person.
      window.dispatchEvent(new CustomEvent(DRIVE_SIGN_OUT_EVENT, { detail: { userId } }));
      store.setItem(DRIVE_SIGN_OUT_KEY, `${userId}:${Date.now()}`); // …and in this browser's other tabs
      clearUserDrives(store, userId);
    } catch {
      // storage blocked: nothing can be waiting there
    }
  }
  return <form action={action} onSubmit={onSubmit} className={className}>{children}</form>;
}
