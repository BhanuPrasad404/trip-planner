import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeLink } from "@/lib/client/media-report";
import { supabaseMediaStorage } from "@/lib/social/storage";

describe("a broken picture is reported without leaking its secret link", () => {
  it("keeps the site and folder, drops the signature", () => {
    const url = "https://abc.supabase.co/storage/v1/object/sign/post-media/u1/p1/a.jpg?token=SECRET.jwt.value";
    const safe = safeLink(url);
    expect(safe).toBe("abc.supabase.co/storage/v1/object/sign/post-media/u1");
    expect(safe).not.toContain("SECRET"); expect(safe).not.toContain("token");
    expect(safeLink("blob:http://x/123")).toBe("blob"); expect(safeLink("not a link")).toBe("unparseable link");
  });
});

describe("making picture links: failures are said, not swallowed", () => {
  const storageWith = (answer: { data: unknown; error: { message: string } | null }) => {
    const sb = { storage: { from: () => ({ createSignedUrls: async () => answer }) } } as unknown as SupabaseClient;
    return supabaseMediaStorage(sb);
  };
  it("a whole failed call is printed, and no links are returned", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await storageWith({ data: null, error: { message: "JWT expired" } }).signedUrls(["u1/a.jpg"]);
    expect(out.size).toBe(0);
    expect(err.mock.calls.flat().join(" ")).toContain("JWT expired");
    err.mockRestore();
  });
  it("files refused one by one are counted and the first reason printed; the good ones still get links", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await storageWith({ data: [{ path: "u1/a.jpg", signedUrl: "https://s/a?token=x", error: null }, { path: "u1/b.jpg", signedUrl: null, error: "Object not found" }], error: null }).signedUrls(["u1/a.jpg", "u1/b.jpg"]);
    expect([...out.keys()]).toEqual(["u1/a.jpg"]);
    const said = err.mock.calls.flat().join(" ");
    expect(said).toContain("1 of 2"); expect(said).toContain("Object not found");
    err.mockRestore();
  });
  it("all good: silent", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await storageWith({ data: [{ path: "u1/a.jpg", signedUrl: "https://s/a", error: null }], error: null }).signedUrls(["u1/a.jpg"]);
    expect(out.size).toBe(1); expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
