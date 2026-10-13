"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client/report-error";

/** Listens for crashes and failed promises anywhere in the page and reports them (see lib/monitoring.ts). Renders nothing. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError("window.onerror", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError("unhandledrejection", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
