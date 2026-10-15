import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ net: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/alert-channels", () => ({ registerAlertWorker: vi.fn(async () => true) }));
vi.mock("@/lib/client/use-connectivity", () => ({
  useConnectivityMonitor: () => {},
  useConnectivity: () => state.net,
}));
import { OfflineBanner } from "@/components/OfflineBanner";

const base = { status: "online", checking: false, since: 0, recovery: null, nextRetryAt: null, failures: 0, online: true, retryNow: vi.fn(), acknowledgeRecovery: vi.fn() };
const render = (o: Record<string, unknown> = {}) => { state.net = { ...base, ...o }; return renderToStaticMarkup(<OfflineBanner />); };

beforeEach(() => { state.net = base; });

describe("OfflineBanner", () => {
  it("online and healthy: the strip is collapsed (zero-height row) and marked hidden", () => {
    const h = render();
    expect(h).toContain('data-offline-banner="hidden"'); expect(h).toContain("grid-rows-[0fr]"); expect(h).not.toContain("Try again");
  });
  it("offline: opens, says what still works and what is paused, and offers Try again", () => {
    const h = render({ status: "offline", online: false, nextRetryAt: Date.now() + 8_000 });
    expect(h).toContain('data-offline-banner="offline"'); expect(h).toContain("grid-rows-[1fr]");
    expect(h).toContain("You&#x27;re offline"); expect(h).toContain("still here"); expect(h).toContain("Try again");
  });
  it("is announced politely to screen readers (a status region, not an alert that interrupts)", () => {
    const h = render({ status: "offline", online: false });
    expect(h).toContain('role="status"'); expect(h).toContain('aria-live="polite"');
  });
  it("while a check runs the button says so and is disabled (no double taps)", () => {
    const h = render({ status: "offline", online: false, checking: true });
    expect(h).toContain("Checking…"); expect(h).toMatch(/<button[^>]*disabled/);
  });
  it("back online after a long outage: says so and that the trip is being updated, with no retry button", () => {
    const h = render({ recovery: { offlineMs: 60_000, at: 1 } });
    expect(h).toContain('data-offline-banner="recovered"'); expect(h).toContain("Back online"); expect(h).toContain("Updating your trip"); expect(h).not.toContain("Try again");
  });
  it("back online after a blip: just 'Back online', no claim about updating", () => {
    const h = render({ recovery: { offlineMs: 3_000, at: 1 } });
    expect(h).toContain("Back online"); expect(h).not.toContain("Updating");
  });
  it("respects reduced motion (no transition, no pulsing icon) and the phone's safe area", () => {
    const h = render({ status: "offline", online: false });
    expect(h).toContain("motion-reduce:transition-none"); expect(h).toContain("motion-safe:animate-pulse"); expect(h).toContain("safe-area-inset-top");
  });
  it("the retry control is a real button at least 44 px tall", () => { expect(render({ status: "offline", online: false })).toContain("min-h-11"); });
});
