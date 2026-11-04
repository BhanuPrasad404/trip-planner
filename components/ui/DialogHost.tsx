"use client";

// Draws the dialogs asked for through lib/client/dialog.ts as a bottom sheet (a centred card on larger screens). Mounted once, in the app frame.
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "./Button";
import { PickerSheet } from "./Sheet";
import { answer, current, registerHost, subscribe } from "@/lib/client/dialog";

export function DialogHost() {
  useEffect(() => registerHost(), []);
  const req = useSyncExternalStore(subscribe, current, () => null);
  if (!req) return null;
  return (
    <PickerSheet key={req.id} title={req.title} onClose={() => answer(req.id, false)} footer={
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant={req.danger ? "danger" : "primary"} className="min-h-12 w-full sm:w-auto sm:flex-1" onClick={() => answer(req.id, true)}>{req.confirmLabel ?? "OK"}</Button>
        {req.cancelLabel !== null && req.cancelLabel !== undefined && <Button variant="secondary" className="min-h-12 w-full sm:w-auto sm:flex-1" onClick={() => answer(req.id, false)}>{req.cancelLabel}</Button>}
      </div>
    }>
      <p role="alertdialog" className="px-4 py-4 text-base text-ink">{req.body}</p>
    </PickerSheet>
  );
}
