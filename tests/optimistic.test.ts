import { describe, expect, it } from "vitest";
import { NO_OVERRIDES, applyPlaceOverrides, applyVoteOverrides, dropOverride, withPlaceOverride, withVote, withVoteOverride } from "@/lib/optimistic";
import type { VoteSummary } from "@/lib/votes";

const P = [{ id: "a", status: "planned", status_at: null }, { id: "b", status: "planned", status_at: null }, { id: "c", status: "done", status_at: "2026-10-01T00:00:00Z" }];
const V: Record<string, VoteSummary> = { a: { up: 2, down: 1, score: 1, mine: 1 }, b: { up: 0, down: 0, score: 0, mine: 0 } };
const NOW = () => "2026-10-12T10:00:00.000Z";

describe("withVote — what the numbers become when you change your own vote", () => {
  it("a first up-vote adds one", () => expect(withVote(undefined, 1)).toEqual({ up: 1, down: 0, score: 1, mine: 1 }));
  it("switching from up to down moves one count across", () => expect(withVote({ up: 2, down: 1, score: 1, mine: 1 }, -1)).toEqual({ up: 1, down: 2, score: -1, mine: -1 }));
  it("tapping your vote again (0) takes it away", () => expect(withVote({ up: 2, down: 1, score: 1, mine: 1 }, 0)).toEqual({ up: 1, down: 1, score: 0, mine: 0 }));
  it("never goes below zero, even from inconsistent data", () => expect(withVote({ up: 0, down: 0, score: 0, mine: 1 }, 0)).toEqual({ up: 0, down: 0, score: 0, mine: 0 }));
});

describe("overrides: instant change, tied to the exact server data", () => {
  it("marking a stop done shows done at once (with a time) and leaves the others and the original data untouched", () => {
    const o = withPlaceOverride(NO_OVERRIDES, P, V, "a", { status: "done" });
    const shown = applyPlaceOverrides(P, o, P, NOW);
    expect(shown.find((p) => p.id === "a")).toMatchObject({ status: "done", status_at: "2026-10-12T10:00:00.000Z" });
    expect(shown.find((p) => p.id === "b")).toBe(P[1]);
    expect(P[0].status).toBe("planned");
  });
  it("undo (planned) clears the time", () => {
    const o = withPlaceOverride(NO_OVERRIDES, P, V, "c", { status: "planned" });
    expect(applyPlaceOverrides(P, o, P, NOW).find((p) => p.id === "c")).toMatchObject({ status: "planned", status_at: null });
  });
  it("removing hides the stop", () => {
    const o = withPlaceOverride(NO_OVERRIDES, P, V, "b", { removed: true });
    expect(applyPlaceOverrides(P, o, P).map((p) => p.id)).toEqual(["a", "c"]);
  });
  it("votes: the count and 'mine' change at once", () => {
    const o = withVoteOverride(NO_OVERRIDES, P, V, "b", 1);
    expect(applyVoteOverrides(V, o, V).b).toEqual({ up: 1, down: 0, score: 1, mine: 1 });
    expect(applyVoteOverrides(V, o, V).a).toBe(V.a);
  });
  it("when the request FAILS the change is taken back", () => {
    let o = withPlaceOverride(NO_OVERRIDES, P, V, "a", { status: "done" });
    o = withVoteOverride(o, P, V, "a", -1);
    o = dropOverride(o, "a");
    expect(applyPlaceOverrides(P, o, P)).toBe(P);
    expect(applyVoteOverrides(V, o, V)).toBe(V);
  });
  it("a drop for something never changed is harmless", () => {
    expect(dropOverride(NO_OVERRIDES, "zzz")).toBe(NO_OVERRIDES);
  });
  it("when the server sends NEW data, the local changes are discarded completely (nothing lingers)", () => {
    const o = withPlaceOverride(NO_OVERRIDES, P, V, "a", { status: "done" });
    const fresh = [{ id: "a", status: "skipped", status_at: "2026-10-12T09:00:00Z" }, ...P.slice(1)];
    expect(applyPlaceOverrides(fresh, o, fresh)).toBe(fresh);          // the server's word wins
    const v2 = { ...V };
    expect(applyVoteOverrides(v2, withVoteOverride(o, P, V, "a", 0), v2)).toBe(v2);
  });
  it("a second tap while the first is still saving builds on the first, not on stale data", () => {
    let o = withPlaceOverride(NO_OVERRIDES, P, V, "a", { status: "done" });
    o = withPlaceOverride(o, P, V, "b", { status: "skipped" });
    const shown = applyPlaceOverrides(P, o, P, NOW);
    expect(shown.map((p) => p.status)).toEqual(["done", "skipped", "done"]);
  });
  it("with no changes the SAME array comes back (so nothing re-renders for no reason)", () => {
    expect(applyPlaceOverrides(P, NO_OVERRIDES, P)).toBe(P);
    expect(applyVoteOverrides(V, NO_OVERRIDES, V)).toBe(V);
  });
});
