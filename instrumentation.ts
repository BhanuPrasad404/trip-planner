import type { Instrumentation } from "next";

// Next.js calls this for every error thrown while serving a request that is NOT already handled (a crashed page, a route that
// threw). It is how "something broke on the server" reaches the alert channel (lib/monitoring.ts). Redirects and "not found"
// are not errors and never arrive here.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { reportError } = await import("@/lib/monitoring");
  reportError(err, { where: "server", extra: { route: context.routePath, kind: context.routeType, method: request.method } });
};
