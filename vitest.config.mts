import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests run in UTC on every computer, like GitHub's CI. The app always uses India time (+5:30) explicitly, so a test that only passes
// in India's time zone has a hidden local-time assumption: this catches it here, before CI does. To check the other side, run with
// another zone set, e.g. `TZ=Asia/Kolkata npx vitest run` (a TZ that is already set is kept).
const TZ = process.env.TZ || "UTC";
process.env.TZ = TZ;

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node", env: { TZ } },
});
