import { describe, expect, it, vi } from "vitest";
import { IMAGE_BUDGET_CHARS, fileToBudgetedDataUrl } from "@/lib/client/image";

const file = {} as File;
const sized = (n: number) => "x".repeat(n);

describe("fileToBudgetedDataUrl: screenshots must fit in one request", () => {
  it("uses the best quality when it fits", async () => {
    const compress = vi.fn(async () => sized(500_000));
    expect((await fileToBudgetedDataUrl(file, 0, compress as never)).length).toBe(500_000);
    expect(compress).toHaveBeenCalledTimes(1); expect(compress).toHaveBeenCalledWith(file, 1600, 0.82);
  });
  it("shrinks in steps until the whole set fits", async () => {
    const compress = vi.fn(async (_f: File, side: number) => sized(side === 1600 ? 2_000_000 : side === 1280 ? 1_500_000 : 800_000));
    const out = await fileToBudgetedDataUrl(file, 2_500_000, compress as never);
    expect(out.length).toBe(800_000); expect(compress).toHaveBeenCalledTimes(3);
  });
  it("counts what is already added: the SECOND picture gets less room than the first", async () => {
    const compress = vi.fn(async () => sized(1_000_000));
    await expect(fileToBudgetedDataUrl(file, 2_600_000, compress as never)).resolves.toBeDefined();
    await expect(fileToBudgetedDataUrl(file, 2_600_001, compress as never)).rejects.toThrow(/too large to send together/);
  });
  it("refuses with a plain message (and sends nothing) when even the smallest size cannot fit", async () => {
    const compress = vi.fn(async () => sized(IMAGE_BUDGET_CHARS + 1));
    await expect(fileToBudgetedDataUrl(file, 0, compress as never)).rejects.toThrow(/Remove one, or crop/);
    expect(compress).toHaveBeenCalledTimes(3);
  });
  it("passes a decode failure through untouched (the message already says what to try)", async () => {
    const compress = vi.fn(async () => { throw new Error("Couldn't read that image. Try a JPG or PNG screenshot."); });
    await expect(fileToBudgetedDataUrl(file, 0, compress as never)).rejects.toThrow(/JPG or PNG/);
    expect(compress).toHaveBeenCalledTimes(1);
  });
  it("the budget stays safely under the 4.5 MB request limit once the JSON around it is counted", () => { expect(IMAGE_BUDGET_CHARS).toBeLessThan(4_500_000 - 500_000); });
});
