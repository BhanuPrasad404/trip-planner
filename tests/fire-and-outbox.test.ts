// Two review fixes outside the drive itself: a fire-and-forget Supabase request must really be SENT, and one person's waiting
// changes for a trip are sent once even when two screens hold an outbox.
import { describe, expect, it } from "vitest";
import { fire } from "@/lib/client/fire";

describe("fire: a request nobody waits for is still sent", () => {
  it("a lazy query (like Supabase's) runs only when its then() is called; `void q` never calls it, fire does", async () => {
    let sent = 0;
    const lazy = { then(ok?: (v: unknown) => unknown) { sent++; return Promise.resolve(null).then(ok); } };
    void lazy; // what the old code did: nothing is sent
    expect(sent).toBe(0);
    fire(lazy as PromiseLike<unknown>);
    await Promise.resolve(); await Promise.resolve();
    expect(sent).toBe(1);
  });
  it("a failing request never throws out of fire (offline)", async () => {
    const failing = { then(_ok: unknown, bad?: (e: unknown) => unknown) { return Promise.reject(new Error("offline")).then(undefined, bad); } };
    expect(() => fire(failing as PromiseLike<unknown>)).not.toThrow();
    await Promise.resolve();
  });
});
