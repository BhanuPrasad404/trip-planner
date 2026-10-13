import { describe, expect, it } from "vitest";
import { PERMISSIONS_POLICY, securityHeaders } from "@/lib/security-headers";

const directive = (name: string) => PERMISSIONS_POLICY.split(",").map((d) => d.trim()).find((d) => d.startsWith(`${name}=`));

describe("Permissions-Policy (the reason the camera was 'blocked' for everyone)", () => {
  it("lets the app's own pages use the camera and microphone", () => {
    expect(directive("camera")).toBe("camera=(self)");
    expect(directive("microphone")).toBe("microphone=(self)");
  });
  it("never switches the camera or microphone off site-wide again", () => {
    expect(PERMISSIONS_POLICY).not.toMatch(/camera=\(\)/);
    expect(PERMISSIONS_POLICY).not.toMatch(/microphone=\(\)/);
  });
  it("keeps location for the app and nothing is opened to other origins", () => {
    expect(directive("geolocation")).toBe("geolocation=(self)");
    expect(PERMISSIONS_POLICY).not.toContain("*");
  });
  it("is served on every page together with the other security headers", () => {
    const keys = securityHeaders.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["Permissions-Policy", "X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security", "Referrer-Policy"]));
  });
});
