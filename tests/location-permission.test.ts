import { describe, expect, it } from "vitest";
import { diagnoseLocation, type LocationEnv } from "@/lib/location/permission";

const env = (o: Partial<LocationEnv> = {}): LocationEnv => ({ secure: true, hasApi: true, embedded: false, policyAllows: true, permission: "prompt", ...o });
const err = (code: number) => ({ code });

describe("diagnoseLocation — each failure says its own reason and what to do", () => {
  it("a block set earlier says how to undo it, including the iPhone path, and stops the drive", () => {
    const d = diagnoseLocation(err(1), env({ permission: "denied" }));
    expect(d).toMatchObject({ problem: "denied", fatal: true });
    expect(d.message).toMatch(/lock.*Location to Allow/i);
    expect(d.message).toMatch(/iPhone.*Safari Websites/i);
  });
  it("a closed prompt just asks them to allow it (and to choose Precise)", () => {
    const d = diagnoseLocation(err(1), env({ permission: "prompt" }));
    expect(d.problem).toBe("dismissed");
    expect(d.message).toMatch(/Allow.*Precise/i);
  });
  it("an insecure page is named before anything else (browsers report it as 'denied')", () => {
    expect(diagnoseLocation(err(1), env({ secure: false })).problem).toBe("insecure");
  });
  it("a site-wide policy block is not blamed on the user's settings", () => {
    const d = diagnoseLocation(err(1), env({ policyAllows: false }));
    expect(d.problem).toBe("policy");
    expect(d.message).not.toMatch(/Tap the lock/);
  });
  it("inside another page, and a browser with no location API, are reported as such", () => {
    expect(diagnoseLocation(err(1), env({ embedded: true })).problem).toBe("embedded");
    expect(diagnoseLocation({}, env({ hasApi: false })).problem).toBe("unsupported");
  });
  it("no signal and timeouts are NOT fatal: the drive keeps trying", () => {
    expect(diagnoseLocation(err(2), env())).toMatchObject({ problem: "unavailable", fatal: false });
    expect(diagnoseLocation(err(3), env())).toMatchObject({ problem: "timeout", fatal: false });
    expect(diagnoseLocation(err(2), env()).message).toMatch(/GPS is on.*airplane/i);
  });
  it("when the browser can't tell us anything, a denial still gets the honest instructions", () => {
    expect(diagnoseLocation(err(1), null)).toMatchObject({ problem: "denied", fatal: true });
  });
});
