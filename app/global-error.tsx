"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client/report-error";

// The last-resort screen: shown only if the page's own frame (layout) crashes. It must bring its own <html> and <body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError("global-error", error); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#EAF4F1", margin: 0 }}>
        <main style={{ maxWidth: 420, margin: "15vh auto", padding: 24, background: "#fff", borderRadius: 24, textAlign: "center", border: "1px solid #D8E3E0" }}>
          <h1 style={{ color: "#0B3D3A", fontSize: 24 }}>Something went off-trail</h1>
          <p style={{ color: "#55625F" }}>We hit an unexpected problem and have been told about it. Please try again.</p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "#55625F" }}>Ref: {error.digest}</p>}
          <button onClick={reset} style={{ marginTop: 16, padding: "12px 24px", borderRadius: 12, border: 0, background: "#1C7C6D", color: "#fff", fontWeight: 600, fontSize: 16 }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
