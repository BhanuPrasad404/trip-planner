// ONE tab runs the drive. Two Trailmate tabs open on the same phone must not both follow GPS, share the position and chime: the
// first one holds a browser lock (Web Locks API) for this person's drive; another tab sees the lock taken and only shows a note.
// Browsers without Web Locks (very old ones) simply run unguarded, as before.

type Locks = { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void> | void) => Promise<unknown> };

export const driveLockName = (userId: string) => `tm-drive:${userId}`;

/** Resolves to a release function when this tab now owns the drive, or null when another tab already does. */
export function acquireDriveLock(userId: string, locks: Locks | undefined = typeof navigator !== "undefined" ? (navigator as unknown as { locks?: Locks }).locks : undefined): Promise<(() => void) | null> {
  if (!locks?.request) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    let settled = false;
    locks.request(driveLockName(userId), { ifAvailable: true }, (lock) => {
      if (!lock) { settled = true; resolve(null); return; }
      // Held until released: the promise returned here keeps the lock.
      return new Promise<void>((release) => { settled = true; resolve(() => release()); });
    }).catch(() => { if (!settled) resolve(() => {}); }); // a lock error must never stop a drive
  });
}
