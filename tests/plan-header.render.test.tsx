import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanHeader } from "@/components/PlanHeader";

const base = { name: "Vizag trip", dates: "Thu, 15 Oct to Fri, 16 Oct", meta: "2 days · 4 places", status: "≈95 km straight-line", countdown: "Your trip starts tomorrow (Thu, 15 Oct).", active: null, onTool: vi.fn(), hasDates: true } as const;
const html = (o: Partial<Parameters<typeof PlanHeader>[0]> = {}) => renderToStaticMarkup(<PlanHeader {...base} {...o} />);

describe("PlanHeader: what a traveller needs first, and the three things they can do", () => {
  it("shows which trip, when, how big, and the driving line", () => {
    const h = html();
    for (const t of ["Vizag trip", "Thu, 15 Oct to Fri, 16 Oct", "2 days · 4 places", "≈95 km straight-line", "Your trip starts tomorrow"]) expect(h).toContain(t);
  });
  it("has exactly three tool buttons, each large enough to tap, and the active one is marked", () => {
    const h = html({ active: "leave" });
    expect(h.match(/aria-pressed="/g)?.length).toBe(4); // three tools + the dates button
    expect(h).toContain("min-h-[3.75rem]");
    expect(h.match(/aria-pressed="true"/g)?.length).toBe(1);
  });
  it("a trip without dates asks for them, prominently", () => {
    const h = html({ hasDates: false, dates: "No dates yet", countdown: null });
    expect(h).toContain("Set dates"); expect(h).toContain("No dates yet"); expect(h).toContain("bg-marigold-light");
  });
  it("a trip with dates offers a quiet 'Dates' button instead", () => { expect(html()).not.toContain("Set dates"); expect(html()).toContain(">Dates<"); });
  it("without a driving line or countdown it shows neither, rather than an empty box", () => {
    const h = html({ status: null, countdown: null });
    expect(h).not.toContain("straight-line"); expect(h).not.toContain("rounded-full bg-sky px-3");
  });
  it("is the page's single heading level 1", () => { expect(html().match(/<h1/g)?.length).toBe(1); });
});
