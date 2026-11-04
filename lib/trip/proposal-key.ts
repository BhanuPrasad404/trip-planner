// Identity of a proposed change. Two requests that would produce the SAME suggestion (same schedule, same bookings, same way of dealing
// with it, same stated preferences) get the same key, so asking again (a page refresh, a second tap, a second device) shows the suggestion
// that already exists instead of storing another copy. Pure: no clock, no database.
import type { Strategy } from "./replan-proposal";

export type ProposalKeyInput = {
  strategy: Strategy;
  baseRev: number | null;
  /** scheduleSignature(): changes when a stop moves, is done or skipped. */
  signature: string;
  /** commitmentsSignature(): changes when a booking changes. */
  commitSig: string;
  nightDriving: boolean;
  pace: string | null;
  keep: readonly string[];
  drop: readonly string[];
  pins: Record<string, number> | undefined;
  fuelPercent: number | null;
  /** What the journey was doing, and which trip day it was: a different situation is a different question. */
  journey: string;
  nowDay: number;
  /** Which window of PROPOSAL_REUSE_MS the request falls in: a suggestion is reused within its window, and looked at afresh after it. */
  bucket: number;
};

/** A short stable fingerprint (FNV-1a, two lanes) of everything above. The order of keep/drop/pins does not matter. */
export function proposalKey(i: ProposalKeyInput): string {
  const parts = [
    i.strategy, i.baseRev ?? "-", i.signature, i.commitSig, i.nightDriving ? "n1" : "n0", i.pace ?? "-",
    [...i.keep].sort().join(","), [...i.drop].sort().join(","),
    Object.entries(i.pins ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(","),
    i.fuelPercent === null ? "-" : Math.round(i.fuelPercent / 10) * 10, i.journey, i.nowDay, i.bucket,
  ].join("|");
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let k = 0; k < parts.length; k++) {
    const c = parts.charCodeAt(k);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}${parts.length.toString(36)}`;
}

/** A stored suggestion is reused for this long; after that the situation (the clock) may have moved enough to deserve a fresh look. */
export const PROPOSAL_REUSE_MS = 3 * 3_600_000;
export const proposalBucket = (nowMs: number): number => Math.floor(nowMs / PROPOSAL_REUSE_MS);
