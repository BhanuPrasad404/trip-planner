"use client";

import { useCallback } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";

/** One switch for every sound a drive makes: the voice and the arrival chime. Kept on this phone. On unless the traveller mutes it. */
export const driveSoundKey = "tm:drive-sound";
const DEFAULT = { on: true };

export function useDriveSound(): [boolean, () => void] {
  const [v, set] = useLocalJson(driveSoundKey, DEFAULT);
  const on = v.on !== false;
  const toggle = useCallback(() => set((cur) => ({ on: cur.on === false })), [set]);
  return [on, toggle];
}
