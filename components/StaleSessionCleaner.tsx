"use client";

// Shown on the login page after the Auth server said the old session is gone: forget the stale cookie on this device (only this device),
// so the next page load doesn't start from a session that can't work. Renders nothing.
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function StaleSessionCleaner() {
  useEffect(() => {
    void createClient().auth.signOut({ scope: "local" }).catch(() => undefined);
  }, []);
  return null;
}
