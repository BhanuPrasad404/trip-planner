"use client";

import { useCallback, useState } from "react";

export type Toast = { id: number; text: string; undo?: () => void; link?: { label: string; href: string } };

/** Short messages at the bottom of the screen. One with an action (Undo, Open trip) stays a little longer so it can be used. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, extra?: { undo?: () => void; link?: Toast["link"] }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, ...extra }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), extra?.undo || extra?.link ? 6500 : 3500);
  }, []);
  return { toasts, toast, dismiss };
}
