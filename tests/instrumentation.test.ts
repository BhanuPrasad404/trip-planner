import { describe, expect, it, vi } from "vitest";
const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
import { onRequestError } from "@/instrumentation";

describe("onRequestError (server crashes reach the alert channel)", () => {
  it("reports the error with the route, kind and method but not the URL, headers or cookies", async () => {
    const err = new Error("render failed");
    await onRequestError(err, { path: "/trips/abc?token=secret", method: "GET", headers: { cookie: "sb=secret" } }, { routerKind: "App Router", routePath: "/trips/[id]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined });
    expect(reportError).toHaveBeenCalledWith(err, { where: "server", extra: { route: "/trips/[id]", kind: "render", method: "GET" } });
    expect(JSON.stringify(reportError.mock.calls)).not.toContain("secret");
  });
});
