// The feed cursor is STATELESS: it carries the rest of the ranked snapshot, so scrolling needs no server memory (works on
// serverless, survives deploys) and a page never reshuffles under the reader's thumb when counters change.
// It is not trusted: every id is re-fetched through row-level security, so tampering can only show posts the person could already see.
import { z } from "zod";
import { INTENT_IDS, PAGE } from "./config";

const uuid = z.string().uuid();
const cursorSchema = z.object({
  v: z.literal(1),
  /** Ranked ids still to show. */
  ids: z.array(uuid).max(PAGE.snapshot * 2),
  /** Recently shown ids, so the next snapshot does not repeat them. */
  seen: z.array(uuid).max(PAGE.seenTail * 2),
  /** How many snapshots this scroll session has used (varies the exploration seed). */
  gen: z.number().int().min(0).max(1000),
  /** The mode this scroll started in, so later pages stay consistent. Older cursors have none and mean "for you". */
  intent: z.enum(INTENT_IDS).default("for_you"),
});
export type FeedCursor = z.infer<typeof cursorSchema>;
export type FeedCursorInput = Omit<z.input<typeof cursorSchema>, "v">;

export function encodeCursor(c: FeedCursorInput): string {
  return Buffer.from(JSON.stringify({ v: 1, ...c })).toString("base64url");
}

/** null = absent or invalid (callers treat it as "start a new feed"). */
export function decodeCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw || raw.length > 20_000) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
