// Phase 0: how a change to a stop's progress is judged (lib/trip/progress.ts) and what the outbox sends for it.
import { describe, expect, it } from "vitest";
import { MAX_EVENT_AGE_MS, MAX_FUTURE_SKEW_MS, conflictMessage, decideArrival, decideStatusChange, eventTime } from "@/lib/trip/progress";
import { addToOutbox, newEventId, parseOutbox, requestFor, type OutboxItem } from "@/lib/client/outbox";

const NOW = Date.parse("2026-11-02T22:00:00Z");

describe("eventTime: when the traveller acted, not when the server heard", () => {
  it("keeps the time of an action made hours ago (2 PM offline, sent at 10 PM)", () => {
    const r = eventTime("2026-11-02T14:00:00Z", NOW);
    expect(r).toEqual({ ok: true, at: "2026-11-02T14:00:00.000Z", clamped: false });
  });
  it("no time sent (an older app): now", () => {
    expect(eventTime(undefined, NOW)).toEqual({ ok: true, at: new Date(NOW).toISOString(), clamped: false });
  });
  it("a phone clock that runs fast is clamped to now, and says so", () => {
    expect(eventTime(new Date(NOW + MAX_FUTURE_SKEW_MS + 60_000).toISOString(), NOW)).toEqual({ ok: true, at: new Date(NOW).toISOString(), clamped: true });
    expect(eventTime(new Date(NOW + 60_000).toISOString(), NOW)).toMatchObject({ ok: true, clamped: false }); // small skew is fine
  });
  it("a change older than the outbox keeps is refused, never silently stamped as now", () => {
    expect(eventTime(new Date(NOW - MAX_EVENT_AGE_MS - 1000).toISOString(), NOW)).toMatchObject({ ok: false });
    expect(eventTime("not a time", NOW)).toMatchObject({ ok: false });
  });
});

describe("decideStatusChange", () => {
  it("applies a normal change", () => expect(decideStatusChange({ status: "planned" }, { status: "done", expected: "planned" })).toEqual({ kind: "apply" }));
  it("the same event id again is a duplicate, not applied twice", () => {
    expect(decideStatusChange({ status: "done", status_event_id: "evt-aaaaaaaa" }, { status: "done", event_id: "evt-aaaaaaaa" })).toEqual({ kind: "duplicate" });
  });
  it("a stale device cannot overwrite: expected 'planned' but the stop is already done", () => {
    expect(decideStatusChange({ status: "done" }, { status: "skipped", expected: "planned" })).toEqual({ kind: "conflict", current: "done" });
  });
  it("a stale 'undo' cannot silently revive a stop another device finished and then skipped", () => {
    expect(decideStatusChange({ status: "skipped" }, { status: "planned", expected: "done" })).toEqual({ kind: "conflict", current: "skipped" });
  });
  it("an explicit undo that matches what the server holds goes through", () => {
    expect(decideStatusChange({ status: "done" }, { status: "planned", expected: "done" })).toEqual({ kind: "apply" });
  });
  it("already where the sender wants it: unchanged, even when expected is stale (nothing to overwrite)", () => {
    expect(decideStatusChange({ status: "done" }, { status: "done", expected: "planned" })).toEqual({ kind: "unchanged" });
  });
  it("an older app version (no expected) is judged as before: applied", () => {
    expect(decideStatusChange({ status: "done" }, { status: "planned" })).toEqual({ kind: "apply" });
  });
  it("a missing or odd stored status counts as planned", () => {
    expect(decideStatusChange({ status: null }, { status: "done", expected: "planned" })).toEqual({ kind: "apply" });
    expect(decideStatusChange({ status: "weird" }, { status: "done", expected: "planned" })).toEqual({ kind: "apply" });
  });
  it("the conflict message names the current state in plain words", () => {
    expect(conflictMessage("done", "skipped")).toMatch(/already marked done/);
    expect(conflictMessage("planned", "done")).toMatch(/still planned/);
  });
});

describe("decideArrival: arriving is recorded once and never visits the stop", () => {
  it("records a first arrival", () => expect(decideArrival({ status: "planned" }, { arrived: true })).toEqual({ kind: "apply" }));
  it("a second 'arrived' keeps the first (real) arrival time", () => expect(decideArrival({ status: "planned", arrived_at: "2026-11-03T02:00:00Z" }, { arrived: true })).toEqual({ kind: "unchanged" }));
  it("a retry with the same event id is a duplicate", () => expect(decideArrival({ status: "planned", arrived_event_id: "evt-bbbbbbbb" }, { arrived: true, event_id: "evt-bbbbbbbb" })).toEqual({ kind: "duplicate" }));
  it("arriving at a stop already done or skipped adds nothing", () => {
    expect(decideArrival({ status: "done" }, { arrived: true })).toEqual({ kind: "unchanged" });
    expect(decideArrival({ status: "skipped" }, { arrived: true })).toEqual({ kind: "unchanged" });
  });
  it("'not here yet' clears an arrival, and is a no-op when there is none", () => {
    expect(decideArrival({ status: "planned", arrived_at: "2026-11-03T02:00:00Z" }, { arrived: false })).toEqual({ kind: "apply" });
    expect(decideArrival({ status: "planned" }, { arrived: false })).toEqual({ kind: "unchanged" });
  });
});

describe("outbox: ids, expected state and old entries", () => {
  const T0 = 1_800_000_000_000;
  const st = (status: "done" | "skipped" | "planned", extra: Partial<Extract<OutboxItem, { kind: "status" }>> = {}, at = T0): OutboxItem => ({ kind: "status", placeId: "p1", status, at, ...extra });

  it("event ids are unique and valid for the server", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newEventId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newEventId(() => 0.5)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
  it("done then undo while offline: the waiting change keeps what the FIRST one expected (the server's state)", () => {
    let items: OutboxItem[] = [];
    items = addToOutbox(items, st("done", { expected: "planned", eventId: "evt-11111111" })).items;
    items = addToOutbox(items, st("planned", { expected: "done", eventId: "evt-22222222" }, T0 + 1)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "planned", expected: "planned", eventId: "evt-22222222" });
  });
  it("an entry saved before this change (no event id, no expected) is still valid and is sent with its real time", () => {
    const parsed = parseOutbox(JSON.stringify({ items: [st("done")] }), T0 + 1000);
    expect(parsed).toHaveLength(1);
    expect(JSON.parse(requestFor(parsed[0]).init.body as string)).toEqual({ status: "done", at: new Date(T0).toISOString() });
  });
  it("a damaged event id or expected value drops the entry instead of sending it", () => {
    const bad = [st("done", { eventId: "x" }), st("done", { expected: "finished" as never })];
    expect(parseOutbox(JSON.stringify({ items: bad }), T0 + 1000)).toEqual([]);
  });
  it("an arrival entry round-trips", () => {
    const a: OutboxItem = { kind: "arrive", placeId: "p1", arrived: true, eventId: "evt-33333333", at: T0 };
    expect(parseOutbox(JSON.stringify({ items: [a] }), T0 + 1000)).toEqual([a]);
  });
});
