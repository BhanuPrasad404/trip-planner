// "Leaving tomorrow at 6 am": the AI reads WHEN the trip starts, and it is kept only when the traveller's own words say it and it is a
// date we can plan from. The time is saved for that first day only.
import { describe, expect, it, vi } from "vitest";
import { aiReadTrip, checkAiReading } from "@/lib/intake/ai-read";
import { effectiveAnswers, emptyDraft, tripRequests } from "@/lib/intake/draft";
import { createTripSchema } from "@/lib/validation/schemas";

const OPTS = { todayMonth: 10, todayISO: "2026-10-26" };
const text = "repu morning 6 am ki Hyderabad nundi Srisailam, 2 days";

describe("reading when the trip starts", () => {
  it("keeps a date and time backed by the traveller's words", () => {
    const r = checkAiReading(text, { start_date: { value: "2026-10-27", evidence: "repu" }, start_time: { value: "06:00", evidence: "morning 6 am" } }, OPTS);
    expect(r.answers.startDate).toMatchObject({ value: "2026-10-27", source: "ai" });
    expect(r.answers.startTime).toMatchObject({ value: "06:00", source: "ai" });
  });
  it("refuses words that aren't there, past dates, impossible dates and non-times", () => {
    const r = checkAiReading(text, {
      start_date: { value: "2026-10-28", evidence: "day after tomorrow" }, // not in the text
      start_time: { value: "6am", evidence: "6 am" },                      // not a clock time
    }, OPTS);
    expect(r.answers.startDate).toBeUndefined(); expect(r.answers.startTime).toBeUndefined();
    expect(r.unbacked.map((u) => u.key)).toEqual(expect.arrayContaining(["startDate", "startTime"]));
    expect(checkAiReading(text, { start_date: { value: "2026-10-20", evidence: "repu" } }, OPTS).answers.startDate).toBeUndefined(); // past
    expect(checkAiReading(text, { start_date: { value: "2026-02-31", evidence: "repu" } }, OPTS).answers.startDate).toBeUndefined(); // not a date
    expect(checkAiReading(text, { start_date: { value: "2028-10-27", evidence: "repu" } }, OPTS).answers.startDate).toBeUndefined(); // too far
    expect(checkAiReading(text, { start_date: { value: "2026-10-27", evidence: "repu" } }, { todayMonth: 10 }).answers.startDate).toBeUndefined(); // no today to check against
  });
  it("tells the AI what today is, so 'tomorrow' and 'Saturday' can be worked out", async () => {
    const llm = vi.fn(async () => ({}));
    await aiReadTrip(text, llm as never, OPTS);
    const sent = (llm.mock.calls[0] as unknown as [{ content: { text: string }[] }])[0].content[0].text;
    expect(sent).toMatch(/^Today is 2026-10-26 \(Monday\)\./);
    expect(sent).toContain("<trip>");
  });
});

describe("saving the start time", () => {
  const draft = (chosen: Record<string, unknown>) => { const d = { ...emptyDraft(), chosen }; return { d, eff: effectiveAnswers(d, []) }; };
  it("saves the time with the date it was said for", () => {
    const { d, eff } = draft({ days: 2, startDate: "2026-10-27", startTime: "06:00" });
    expect(tripRequests(d, eff, undefined, "2026-10-27").trip).toMatchObject({ start_date: "2026-10-27", start_time: "06:00" });
  });
  it("a different start date drops the time (it belonged to another first day)", () => {
    const { d, eff } = draft({ days: 2, startDate: "2026-10-27", startTime: "06:00" });
    expect(tripRequests(d, eff, undefined, "2026-11-02").trip).not.toHaveProperty("start_time");
  });
  it("no time said: nothing is saved for it, and the server accepts both", () => {
    const { d, eff } = draft({ days: 2 });
    const trip = tripRequests(d, eff, undefined, "2026-10-27").trip;
    expect(trip).not.toHaveProperty("start_time");
    expect(createTripSchema.safeParse(trip).success).toBe(true);
    expect(createTripSchema.safeParse({ ...trip, start_time: "06:00" }).success).toBe(true);
    expect(createTripSchema.safeParse({ ...trip, start_time: "6 am" }).success).toBe(false);
  });
});
