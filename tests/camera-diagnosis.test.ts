import { describe, expect, it } from "vitest";
import { diagnoseCamera, type CameraEnv } from "@/lib/client/recorder";

const env = (o: Partial<CameraEnv> = {}): CameraEnv => ({ secure: true, hasApi: true, embedded: false, policyAllows: true, permission: "prompt", ...o });
const err = (name: string) => ({ name });

describe("diagnoseCamera — each failure says its own reason and what to do", () => {
  it("a site-wide Permissions-Policy block is NOT blamed on the user's browser settings (the reported bug)", () => {
    const d = diagnoseCamera(err("NotAllowedError"), env({ policyAllows: false }));
    expect(d.problem).toBe("policy");
    expect(d.message).toMatch(/setting of the site/i);
    expect(d.message).not.toMatch(/browser settings/i);
  });
  it("a block the person set earlier says how to undo it", () => {
    const d = diagnoseCamera(err("NotAllowedError"), env({ permission: "denied" }));
    expect(d.problem).toBe("denied");
    expect(d.message).toMatch(/lock.*Camera to Allow/i);
  });
  it("a closed or dismissed prompt just asks them to allow it", () => {
    const d = diagnoseCamera(err("NotAllowedError"), env({ permission: "prompt" }));
    expect(d.problem).toBe("dismissed");
    expect(d.message).toMatch(/Try again.*Allow/i);
  });
  it("inside another page it says so", () => {
    expect(diagnoseCamera(err("NotAllowedError"), env({ embedded: true, permission: "prompt" })).problem).toBe("embedded");
  });
  it("an insecure page and a browser without the API are named before anything else", () => {
    expect(diagnoseCamera(err("NotAllowedError"), env({ secure: false })).problem).toBe("insecure");
    expect(diagnoseCamera(err("TypeError"), env({ hasApi: false })).problem).toBe("unsupported");
  });
  it("missing hardware, a busy camera, unmet constraints and unknown errors are all distinct", () => {
    expect(diagnoseCamera(err("NotFoundError"), env()).problem).toBe("no-camera");
    expect(diagnoseCamera(err("NotReadableError"), env()).problem).toBe("in-use");
    expect(diagnoseCamera(err("OverconstrainedError"), env()).problem).toBe("constraints");
    expect(diagnoseCamera(new Error("boom"), env()).problem).toBe("unknown");
  });
  it("when the browser can't tell us anything it still gives the generic, honest message", () => {
    const d = diagnoseCamera(err("NotAllowedError"), null);
    expect(d.problem).toBe("denied");
    expect(d.message).toMatch(/blocked/i);
  });
  it("every message offers the upload fallback or a clear next step", () => {
    for (const n of ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "Whatever"]) {
      const m = diagnoseCamera(err(n), env()).message;
      expect(m).toMatch(/upload|try|switch|close/i);
    }
  });
});
