// Our own "Are you sure?" and "Heads up" dialogs, instead of the browser's grey window.confirm / window.alert. A screen asks with
// `askConfirm` / `showNotice` and awaits the answer; the host (components/ui/DialogHost.tsx, mounted once in the app frame) draws it as a
// bottom sheet. Where no host is mounted (a test, a page outside the frame) `hostMounted()` is false and callers keep their old
// synchronous native prompt, so nothing is ever left waiting for a dialog that cannot appear.
export type DialogOptions = { title: string; body: string; confirmLabel?: string; /** null = a notice with one button. */ cancelLabel?: string | null; danger?: boolean };
export type DialogRequest = DialogOptions & { id: number; resolve: (ok: boolean) => void };

let queue: DialogRequest[] = [];
let hosts = 0;
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const hostMounted = (): boolean => hosts > 0;
export function registerHost(): () => void { hosts++; return () => { hosts = Math.max(0, hosts - 1); }; }
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const current = (): DialogRequest | null => queue[0] ?? null;

function ask(o: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => { queue = [...queue, { ...o, id: nextId++, resolve }]; emit(); });
}
export const askConfirm = (o: Omit<DialogOptions, "cancelLabel"> & { cancelLabel?: string }): Promise<boolean> => ask({ cancelLabel: "Cancel", ...o });
export const showNotice = (o: Omit<DialogOptions, "cancelLabel" | "danger">): Promise<boolean> => ask({ ...o, cancelLabel: null });
/** The host calls this with the person's answer. */
export function answer(id: number, ok: boolean) {
  const r = queue.find((x) => x.id === id);
  if (!r) return;
  queue = queue.filter((x) => x.id !== id);
  emit();
  r.resolve(ok);
}
